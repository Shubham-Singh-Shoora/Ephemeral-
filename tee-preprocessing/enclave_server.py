"""FastAPI service intended to run inside the confidential-compute image.

The service accepts an encrypted-channel dataset payload, trains a bounded
allowlisted model, encrypts the fitted inference artifact to PK_AI, uploads it
to Bee, and signs a proof over immutable job/configuration commitments.
"""

from __future__ import annotations

import gc
import io
import os
import time
from typing import Literal

import pandas as pd
from eth_abi import encode
from eth_hash.auto import keccak
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from enclave_crypto import attestation_for_public_key, canonical_json, encrypt_for_builder, sign_proof, tee_public_key
from dataset_loader import decode_inline_dataset, load_protected_dataset
from onnx_bundler import bundle_fitted_pipeline
from stage1_sanitization import sanitize_and_split, zeroize_frame
from stage2_adaptive_profiles import ModelProfile
from swarm_output import upload_encrypted_artifact
from trainer_convergence import Metric, train_with_convergence


MAX_DATASET_BYTES = int(os.getenv("MAX_DATASET_BYTES", str(100 * 1024 * 1024)))
CODE_MEASUREMENT = os.getenv("ENCLAVE_CODE_MEASUREMENT", "").strip()


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class ExecuteRequest(ApiModel):
    job_id: int = Field(ge=1)
    dataset_id: int = Field(ge=1)
    dataset_csv_base64: str | None = None
    dataset_filename: str = Field(min_length=1, max_length=255)
    dataset_commitment: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")
    encrypted_dataset_ref: str = Field(pattern=r"^0x[0-9a-fA-F]{128}$")
    act_history_ref: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")
    publisher_public_key: str = Field(pattern=r"^0x(?:02|03)[0-9a-fA-F]{64}$|^0x04[0-9a-fA-F]{128}$")
    vault_key_commitment: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")
    model_commitment: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")
    convergence_config_hash: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")
    target_columns: list[str] = Field(min_length=1, max_length=16)
    feature_columns: list[str] = Field(min_length=1, max_length=256)
    task_types: dict[str, Literal["classification", "regression"]]
    model_family: str = Field(min_length=1, max_length=64)
    model_profile: ModelProfile
    target_metric: Metric
    min_target_score: float = Field(gt=0, le=1)
    max_overfit_gap: float = Field(ge=0, le=0.5)
    max_tuning_trials: int = Field(ge=1, le=25)
    split_seed: int = Field(ge=0, le=2**31 - 1)
    min_holdout_score: float | None = Field(default=None, gt=0, le=1)
    builder_public_key: str = Field(pattern=r"^0x(?:02|03)[0-9a-fA-F]{64}$|^0x04[0-9a-fA-F]{128}$")
    nonce: str = Field(min_length=16, max_length=128)
    expires_at: int

    @field_validator("dataset_filename")
    @classmethod
    def supported_dataset(cls, value: str) -> str:
        if not value.lower().endswith((".csv", ".tsv")):
            raise ValueError("The tabular enclave accepts CSV or TSV input")
        return value

    @field_validator("target_columns", "feature_columns")
    @classmethod
    def unique_columns(cls, value: list[str]) -> list[str]:
        normalized = [column.strip() for column in value]
        if any(not column for column in normalized) or len(set(normalized)) != len(normalized):
            raise ValueError("Column lists must contain non-empty unique names")
        return normalized


class Metrics(ApiModel):
    metric: str
    train_score: float
    validation_score: float
    holdout_score: float
    overfit_gap: float
    validation_converged: bool
    holdout_passed: bool
    converged: bool
    trials_run: int


class ExecuteResponse(ApiModel):
    output_model_swarm_hash: str
    output_artifact_hash: str
    output_format: str
    config_hash: str
    split_commitment: str
    metrics: Metrics
    execution_proof: dict
    execution_proof_canonical: str
    execution_proof_hash: str
    proof_signature: str
    tee_public_key: str
    attestation: dict
    cleanup_completed: bool
    cleanup_status: str


app = FastAPI(title="Ephemeral TEE Preprocessing", version="1.0.0", docs_url=None, redoc_url=None)


@app.get("/health")
def health():
    return {"status": "ok", "service": "ephemeral-tee-preprocessing", "version": "1.0.0"}


@app.get("/api/v1/attest")
def attest():
    return {"teePublicKey": tee_public_key(), "attestation": attestation_for_public_key()}


def _read_dataset(request: ExecuteRequest) -> tuple[bytearray, pd.DataFrame]:
    try:
        raw = decode_inline_dataset(request.dataset_csv_base64) if request.dataset_csv_base64 else load_protected_dataset(
            job_id=request.job_id,
            dataset_id=request.dataset_id,
            encrypted_dataset_ref=request.encrypted_dataset_ref,
            act_history_ref=request.act_history_ref,
            publisher_public_key=request.publisher_public_key,
            vault_key_commitment=request.vault_key_commitment,
        )
    except ValueError as exc:
        raise ValueError("datasetCsvBase64 is not valid base64") from exc
    if not raw or len(raw) > MAX_DATASET_BYTES:
        raise ValueError(f"Dataset must contain 1 to {MAX_DATASET_BYTES} bytes")
    separator = "\t" if request.dataset_filename.lower().endswith(".tsv") else ","
    frame = pd.read_csv(io.BytesIO(raw), sep=separator)
    return raw, frame


def _configuration(request: ExecuteRequest) -> dict:
    return {
        "targetColumns": request.target_columns,
        "featureColumns": request.feature_columns,
        "taskTypes": request.task_types,
        "modelFamily": request.model_family,
        "modelProfile": request.model_profile,
        "targetMetric": request.target_metric,
        "minTargetScore": request.min_target_score,
        "maxOverfitGap": request.max_overfit_gap,
        "maxTuningTrials": request.max_tuning_trials,
        "splitSeed": request.split_seed,
        "minHoldoutScore": request.min_holdout_score,
    }


def _convergence_config_hash(request: ExecuteRequest) -> str:
    task_types = [1 if request.task_types[column] == "regression" else 0 for column in request.target_columns]
    encoded = encode(
        ["(string[],string[],uint8[],string,string,uint32,uint32,uint8,uint32)"],
        [(
            request.target_columns,
            request.feature_columns,
            task_types,
            request.model_profile,
            request.target_metric,
            round(request.min_target_score * 1_000_000),
            round(request.max_overfit_gap * 1_000_000),
            request.max_tuning_trials,
            request.split_seed,
        )],
    )
    return "0x" + keccak(encoded).hex()


@app.post("/api/v1/execute-blind-training", response_model=ExecuteResponse)
def execute_blind_training(request: ExecuteRequest):
    if request.expires_at <= int(time.time()):
        raise HTTPException(status_code=422, detail="The execution request has expired")
    if set(request.task_types) != set(request.target_columns):
        raise HTTPException(status_code=422, detail="taskTypes must exactly match targetColumns")
    raw: bytearray | None = None
    frame = None
    splits = None
    artifact_buffer: bytearray | None = None
    try:
        raw, frame = _read_dataset(request)
        config = _configuration(request)
        config_hash = _convergence_config_hash(request)
        if config_hash.lower() != request.convergence_config_hash.lower():
            raise ValueError("Convergence configuration does not match the immutable on-chain hash")
        splits = sanitize_and_split(
            frame,
            request.feature_columns,
            request.target_columns,
            request.task_types,
            request.split_seed,
        )
        result = train_with_convergence(
            splits=splits,
            model_family=request.model_family,
            model_profile=request.model_profile,
            task_types=request.task_types,
            metric=request.target_metric,
            min_target_score=request.min_target_score,
            max_overfit_gap=request.max_overfit_gap,
            max_trials=request.max_tuning_trials,
            seed=request.split_seed,
            min_holdout_score=request.min_holdout_score,
        )
        artifact = bundle_fitted_pipeline(
            result.pipeline,
            splits.x_holdout.head(min(10, len(splits.x_holdout))),
            {
                "version": 1,
                "jobId": str(request.job_id),
                "datasetId": str(request.dataset_id),
                "configHash": config_hash,
                "featureColumns": request.feature_columns,
                "targetColumns": request.target_columns,
                "metric": request.target_metric,
            },
        )
        artifact_buffer = bytearray(artifact.payload)
        envelope = encrypt_for_builder(bytes(artifact_buffer), request.builder_public_key)
        output_reference = upload_encrypted_artifact(envelope, request.job_id)
        model_policy_passed = result.validation_converged and result.holdout_passed
        metrics = {
            "metric": request.target_metric,
            "trainScore": round(result.train_score, 8),
            "validationScore": round(result.validation_score, 8),
            "holdoutScore": round(result.holdout_score, 8),
            "overfitGap": round(result.overfit_gap, 8),
            "validationConverged": result.validation_converged,
            "holdoutPassed": result.holdout_passed,
            "converged": model_policy_passed,
            "trialsRun": len(result.trials),
        }
        attestation = attestation_for_public_key()
        proof_body = {
            "version": 1,
            "jobId": str(request.job_id),
            "datasetId": str(request.dataset_id),
            "datasetCommitment": request.dataset_commitment.lower(),
            "modelCommitment": request.model_commitment.lower(),
            "convergenceConfigHash": config_hash,
            "codeMeasurement": CODE_MEASUREMENT or None,
            "splitSeed": request.split_seed,
            "splitCommitment": splits.split_commitment,
            "outputArtifactHash": artifact.sha256,
            "outputModelSwarmHash": "0x" + output_reference,
            "outputFormat": artifact.format,
            "metrics": metrics,
            "cleanupPolicy": "best-effort-zeroization-followed-by-enclave-teardown",
            "nonce": request.nonce,
            "expiresAt": request.expires_at,
            "attestationReportData": attestation["reportData"],
        }
        proof = sign_proof(proof_body)

        for sensitive in (
            splits.x_train, splits.x_validation, splits.x_holdout,
            splits.y_train, splits.y_validation, splits.y_holdout, frame,
        ):
            zeroize_frame(sensitive)
        for index in range(len(raw)):
            raw[index] = 0
        for index in range(len(artifact_buffer)):
            artifact_buffer[index] = 0
        gc.collect()

        return ExecuteResponse(
            outputModelSwarmHash="0x" + output_reference,
            outputArtifactHash=artifact.sha256,
            outputFormat=artifact.format,
            configHash=config_hash,
            splitCommitment=splits.split_commitment,
            metrics=Metrics(**metrics),
            executionProof=proof.body,
            executionProofCanonical=proof.canonical.decode(),
            executionProofHash=proof.proof_hash,
            proofSignature=proof.signature,
            teePublicKey=proof.signer_public_key,
            attestation=attestation,
            cleanupCompleted=True,
            cleanupStatus="Best-effort buffers cleared; cryptographic destruction completes when the enclave terminates.",
        )
    except HTTPException:
        raise
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Confidential training failed: {type(exc).__name__}") from exc
    finally:
        if raw is not None:
            for index in range(len(raw)):
                raw[index] = 0
        if artifact_buffer is not None:
            for index in range(len(artifact_buffer)):
                artifact_buffer[index] = 0
        gc.collect()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8080, access_log=False)

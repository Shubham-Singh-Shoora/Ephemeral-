"""Retrieve ACT-authorized ciphertext and an attestation-gated Vault key inside the TEE."""

from __future__ import annotations

import base64
import os

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from enclave_crypto import attestation_for_public_key, decrypt_for_tee, tee_public_key


def _authorization_header(name: str) -> dict[str, str]:
    value = os.getenv(name, "").strip()
    return {"Authorization": value} if value else {}


def _release_dataset_key(job_id: int, dataset_id: int, vault_key_commitment: str) -> bytearray:
    endpoint = os.getenv("VAULT_DON_ENDPOINT", "").rstrip("/")
    if not endpoint:
        raise RuntimeError("VAULT_DON_ENDPOINT is required for protected dataset execution")
    response = httpx.post(
        endpoint + "/release",
        headers={"Content-Type": "application/json", **_authorization_header("VAULT_DON_AUTHORIZATION")},
        json={
            "jobId": str(job_id),
            "datasetId": str(dataset_id),
            "vaultKeyCommitment": vault_key_commitment,
            "teePublicKey": tee_public_key(),
            "attestation": attestation_for_public_key(),
        },
        timeout=30,
    )
    response.raise_for_status()
    envelope = response.json()
    if envelope.get("algorithm") != "secp256k1-ecdh+a256gcm":
        raise RuntimeError("Vault DON returned an unsupported key envelope")
    key = decrypt_for_tee(envelope)
    if len(key) != 32:
        raise RuntimeError("Vault DON did not release a 32-byte dataset key")
    return key


def load_protected_dataset(
    *,
    job_id: int,
    dataset_id: int,
    encrypted_dataset_ref: str,
    act_history_ref: str,
    publisher_public_key: str,
    vault_key_commitment: str,
) -> bytearray:
    bee_url = os.getenv("BEE_API_URL", "").rstrip("/")
    if not bee_url:
        raise RuntimeError("BEE_API_URL is required for protected dataset execution")
    dataset_key = _release_dataset_key(job_id, dataset_id, vault_key_commitment)
    try:
        response = httpx.get(
            f"{bee_url}/bzz/{encrypted_dataset_ref.removeprefix('0x')}/",
            headers={
                "Swarm-Act": "true",
                "Swarm-Act-History-Address": act_history_ref.removeprefix("0x"),
                "Swarm-Act-Publisher": publisher_public_key.removeprefix("0x"),
                **_authorization_header("BEE_AUTHORIZATION"),
            },
            timeout=120,
        )
        response.raise_for_status()
        encrypted = response.content
        if len(encrypted) < 28:
            raise RuntimeError("Bee returned an invalid encrypted dataset payload")
        return bytearray(AESGCM(bytes(dataset_key)).decrypt(encrypted[:12], encrypted[12:], None))
    finally:
        for index in range(len(dataset_key)):
            dataset_key[index] = 0


def decode_inline_dataset(encoded: str) -> bytearray:
    if os.getenv("ALLOW_INLINE_DATASET", "false").lower() != "true":
        raise RuntimeError("Inline datasets are disabled; configure the ACT/Vault path")
    return bytearray(base64.b64decode(encoded, validate=True))

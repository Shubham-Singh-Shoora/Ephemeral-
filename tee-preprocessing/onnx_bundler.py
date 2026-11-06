"""Export a fitted preprocessing+estimator pipeline with verified fallback metadata."""

from __future__ import annotations

import hashlib
import io
import json
from dataclasses import dataclass

import joblib
import numpy as np
import pandas as pd


@dataclass(frozen=True)
class BundledArtifact:
    payload: bytes
    format: str
    sha256: str
    metadata: dict


def _joblib_bundle(pipeline, metadata: dict, onnx_error: str | None) -> BundledArtifact:
    buffer = io.BytesIO()
    joblib.dump({"pipeline": pipeline, "metadata": metadata}, buffer, compress=3)
    payload = buffer.getvalue()
    complete = {**metadata, "format": "joblib", "onnxError": onnx_error}
    return BundledArtifact(payload, "joblib", "0x" + hashlib.sha256(payload).hexdigest(), complete)


def _onnx_initial_types(x_sample: pd.DataFrame):
    from skl2onnx.common.data_types import FloatTensorType, StringTensorType

    initial_types = []
    for column in x_sample.columns:
        tensor = FloatTensorType([None, 1]) if pd.api.types.is_numeric_dtype(x_sample[column]) else StringTensorType([None, 1])
        initial_types.append((str(column), tensor))
    return initial_types


def _onnx_inputs(x_sample: pd.DataFrame) -> dict[str, np.ndarray]:
    result = {}
    for column in x_sample.columns:
        if pd.api.types.is_numeric_dtype(x_sample[column]):
            result[str(column)] = x_sample[[column]].to_numpy(dtype=np.float32)
        else:
            result[str(column)] = x_sample[[column]].fillna("").astype(str).to_numpy()
    return result


def bundle_fitted_pipeline(pipeline, x_sample: pd.DataFrame, metadata: dict) -> BundledArtifact:
    """Prefer ONNX after prediction parity; otherwise return a signed-by-proof joblib bundle."""
    try:
        import onnxruntime as ort
        from skl2onnx import convert_sklearn

        model = convert_sklearn(
            pipeline,
            initial_types=_onnx_initial_types(x_sample),
            target_opset=18,
        )
        payload = model.SerializeToString()
        session = ort.InferenceSession(payload, providers=["CPUExecutionProvider"])
        expected = np.asarray(pipeline.predict(x_sample))
        outputs = session.run(None, _onnx_inputs(x_sample))
        predicted = np.asarray(outputs[0])
        if expected.shape != predicted.shape or not np.array_equal(expected.astype(str), predicted.astype(str)):
            raise RuntimeError(f"ONNX parity mismatch: source {expected.shape}, ONNX {predicted.shape}")
        complete = {**metadata, "format": "onnx", "opset": 18, "parityChecked": True}
        return BundledArtifact(payload, "onnx", "0x" + hashlib.sha256(payload).hexdigest(), complete)
    except Exception as exc:  # converter support differs by estimator; fallback is explicit in metadata
        message = f"{type(exc).__name__}: {exc}"
        return _joblib_bundle(pipeline, metadata, message[:500])


def metadata_bytes(metadata: dict) -> bytes:
    return json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode()

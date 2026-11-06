"""Upload already-PK_AI-encrypted artifacts to a configured Bee write endpoint."""

from __future__ import annotations

import json
import os
import re

import httpx


REFERENCE = re.compile(r"^[0-9a-fA-F]{128}$")


def upload_encrypted_artifact(envelope: dict, job_id: int) -> str:
    bee_url = os.getenv("BEE_API_URL", "").rstrip("/")
    batch_id = os.getenv("BEE_POSTAGE_BATCH_ID", "").removeprefix("0x")
    if not bee_url or not re.fullmatch(r"[0-9a-fA-F]{64}", batch_id):
        raise RuntimeError("BEE_API_URL and a 32-byte BEE_POSTAGE_BATCH_ID are required")
    headers = {
        "Content-Type": "application/vnd.ephemeral.encrypted-model+json",
        "Swarm-Postage-Batch-Id": batch_id,
        "Swarm-Pin": "true",
    }
    authorization = os.getenv("BEE_AUTHORIZATION", "").strip()
    if authorization:
        headers["Authorization"] = authorization
    response = httpx.post(
        bee_url + "/bytes",
        params={"encrypt": "true"},
        headers=headers,
        content=json.dumps({**envelope, "jobId": str(job_id)}, separators=(",", ":")).encode(),
        timeout=60,
    )
    response.raise_for_status()
    reference = str(response.json().get("reference", "")).removeprefix("0x")
    if not REFERENCE.fullmatch(reference):
        raise RuntimeError("Bee did not return the expected 64-byte encrypted reference")
    return reference.lower()

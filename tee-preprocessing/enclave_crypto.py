"""TEE key management, canonical proof signing, and PK_AI encryption."""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass

import httpx
from coincurve import PrivateKey, PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from eth_hash.auto import keccak


def _hex(value: bytes) -> str:
    return "0x" + value.hex()


def _private_key() -> PrivateKey:
    configured = os.getenv("TEE_SIGNING_PRIVATE_KEY", "").removeprefix("0x")
    if configured:
        if len(configured) != 64:
            raise RuntimeError("TEE_SIGNING_PRIVATE_KEY must contain exactly 32 bytes")
        return PrivateKey(bytes.fromhex(configured))
    return PrivateKey()


TEE_KEY = _private_key()


def tee_public_key() -> str:
    return _hex(TEE_KEY.public_key.format(compressed=True))


def canonical_json(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


@dataclass(frozen=True)
class SignedProof:
    body: dict
    canonical: bytes
    proof_hash: str
    signature: str
    signer_public_key: str


def sign_proof(body: dict) -> SignedProof:
    canonical = canonical_json(body)
    digest = keccak(canonical)
    signature = TEE_KEY.sign_recoverable(digest, hasher=None)
    return SignedProof(body, canonical, _hex(digest), _hex(signature), tee_public_key())


def encrypt_for_builder(payload: bytes, builder_public_key: str) -> dict:
    public_key = PublicKey(bytes.fromhex(builder_public_key.removeprefix("0x")))
    ephemeral = PrivateKey()
    shared_point = public_key.multiply(ephemeral.secret).format(compressed=False)
    aes_key = keccak(shared_point)
    nonce = os.urandom(12)
    ciphertext_and_tag = AESGCM(aes_key).encrypt(nonce, payload, None)
    return {
        "version": 1,
        "algorithm": "secp256k1-ecdh+a256gcm",
        "ephemeralPublicKey": _hex(ephemeral.public_key.format(compressed=True)),
        "ciphertext": _hex(nonce + ciphertext_and_tag),
    }


def decrypt_for_tee(envelope: dict) -> bytearray:
    ephemeral = PublicKey(bytes.fromhex(str(envelope["ephemeralPublicKey"]).removeprefix("0x")))
    shared_point = ephemeral.multiply(TEE_KEY.secret).format(compressed=False)
    aes_key = bytearray(keccak(shared_point))
    combined = bytes.fromhex(str(envelope["ciphertext"]).removeprefix("0x"))
    if len(combined) < 28:
        raise ValueError("Vault envelope is shorter than an AES-GCM nonce and tag")
    try:
        return bytearray(AESGCM(bytes(aes_key)).decrypt(combined[:12], combined[12:], None))
    finally:
        for index in range(len(aes_key)):
            aes_key[index] = 0


def attestation_for_public_key() -> dict:
    report_data = _hex(keccak(bytes.fromhex(tee_public_key().removeprefix("0x"))))
    provider = os.getenv("ATTESTATION_PROVIDER_URL", "").strip()
    if provider:
        response = httpx.post(provider.rstrip("/") + "/attest", json={"reportData": report_data}, timeout=20)
        response.raise_for_status()
        result = response.json()
        if not result.get("quote"):
            raise RuntimeError("Attestation provider did not return a quote")
        return {"mode": "hardware", "reportData": report_data, **result}
    body = {"mode": "development", "reportData": report_data, "publicKey": tee_public_key()}
    signed = sign_proof(body)
    return {
        **body,
        "quote": base64.b64encode(signed.canonical).decode(),
        "canonical": signed.canonical.decode(),
        "signature": signed.signature,
        "warning": "Software development attestation; production CRE must reject this mode.",
    }

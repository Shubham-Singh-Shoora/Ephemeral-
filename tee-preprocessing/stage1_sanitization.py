"""Stage 1: identifier scrubbing, unit harmonization, then guarded splitting."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Literal

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

from standards.omop_fiddle_mapper import HarmonizedColumn, harmonize_tabular


TaskType = Literal["classification", "regression"]

DIRECT_IDENTIFIER = re.compile(
    r"(^|\b)(sl\s*no|serial|patient\s*id|subject\s*id|medical\s*record|mrn|name|email|phone|mobile|"
    r"address|aadhaar|abha|pan|ssn|account|certificate|license|vehicle|device|url|ip|biometric|photo)(\b|$)",
    re.IGNORECASE,
)
GEOGRAPHY = re.compile(r"(street|district|village|town|city|zip|pin\s*code|postal|location|geograph)", re.IGNORECASE)
SENSITIVE_CONTEXT = re.compile(r"(religion|caste|ethnicity)", re.IGNORECASE)
DATE_IDENTIFIER = re.compile(r"(birth|admission|discharge|death|appointment).*date|(^|\b)date($|\b)", re.IGNORECASE)

VALUE_PATTERNS = (
    re.compile(r"\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b"),  # Aadhaar-like
    re.compile(r"\b\d{2}-?\d{4}-?\d{4}-?\d{4}\b"),  # ABHA-like
    re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b", re.IGNORECASE),
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    re.compile(r"(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)"),
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
)


@dataclass
class DatasetSplits:
    x_train: pd.DataFrame
    x_validation: pd.DataFrame
    x_holdout: pd.DataFrame
    y_train: pd.DataFrame
    y_validation: pd.DataFrame
    y_holdout: pd.DataFrame
    harmonized_columns: list[HarmonizedColumn]
    dropped_columns: list[str]
    split_commitment: str


def is_privacy_excluded(column: str) -> bool:
    return bool(
        DIRECT_IDENTIFIER.search(column)
        or GEOGRAPHY.search(column)
        or SENSITIVE_CONTEXT.search(column)
        or DATE_IDENTIFIER.search(column)
    )


def scrub_free_text(value: object) -> object:
    if not isinstance(value, str):
        return value
    result = value
    for pattern in VALUE_PATTERNS:
        result = pattern.sub("[REDACTED]", result)
    return result


def _split_commitment(*frames: pd.DataFrame, seed: int) -> str:
    payload = {
        "seed": seed,
        "partitions": [sorted(map(str, frame.index.tolist())) for frame in frames],
    }
    return "0x" + hashlib.sha256(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()).hexdigest()


def _classification_strata(
    y: pd.DataFrame,
    task_types: dict[str, TaskType],
    minimum_count: int,
) -> pd.Series | None:
    if not y.columns.tolist() or any(task_types[column] != "classification" for column in y.columns):
        return None
    strata = y.astype("string").fillna("[MISSING]").agg("\x1f".join, axis=1)
    counts = strata.value_counts()
    if counts.empty or int(counts.min()) < minimum_count:
        smallest = int(counts.min()) if not counts.empty else 0
        raise ValueError(
            f"This stratified partition needs at least {minimum_count} rows for every disclosed target combination; "
            f"the smallest combination has {smallest}. Aggregate rare classes or add records."
        )
    return strata


def sanitize_and_split(
    frame: pd.DataFrame,
    feature_columns: list[str],
    target_columns: list[str],
    task_types: dict[str, TaskType],
    seed: int = 42,
) -> DatasetSplits:
    if frame.empty:
        raise ValueError("The clinical dataset is empty")
    if not feature_columns or not target_columns:
        raise ValueError("At least one feature and one target are required")
    if len(set(feature_columns + target_columns)) != len(feature_columns) + len(target_columns):
        raise ValueError("Feature and target columns must be unique and disjoint")
    missing = [column for column in feature_columns + target_columns if column not in frame.columns]
    if missing:
        raise ValueError(f"Columns are missing from the dataset: {', '.join(missing)}")
    if set(task_types) != set(target_columns):
        raise ValueError("Every target column must have exactly one task type")
    excluded_targets = [column for column in target_columns if is_privacy_excluded(column)]
    if excluded_targets:
        raise ValueError(f"Privacy-excluded columns cannot be targets: {', '.join(excluded_targets)}")

    dropped_columns = [str(column) for column in frame.columns if is_privacy_excluded(str(column))]
    excluded_features = [column for column in feature_columns if column in dropped_columns]
    if excluded_features:
        raise ValueError(f"Privacy-excluded columns cannot be features: {', '.join(excluded_features)}")

    selected = frame[feature_columns + target_columns].copy(deep=True)
    for column in selected.select_dtypes(include=["object", "string"]).columns:
        selected[column] = selected[column].map(scrub_free_text)
    selected, metadata = harmonize_tabular(selected)

    for target in target_columns:
        if task_types[target] == "regression":
            selected[target] = pd.to_numeric(selected[target], errors="coerce")
    selected = selected.dropna(subset=target_columns)
    if len(selected) < 20:
        raise ValueError("At least 20 complete target rows are required for a guarded 80/10/10 split")

    x = selected[feature_columns]
    y = selected[target_columns]
    strata = _classification_strata(y, task_types, minimum_count=10)
    x_train, x_temp, y_train, y_temp = train_test_split(
        x,
        y,
        test_size=0.2,
        random_state=seed,
        shuffle=True,
        stratify=strata,
    )
    temp_strata = _classification_strata(y_temp, task_types, minimum_count=2) if strata is not None else None
    x_validation, x_holdout, y_validation, y_holdout = train_test_split(
        x_temp,
        y_temp,
        test_size=0.5,
        random_state=seed,
        shuffle=True,
        stratify=temp_strata,
    )
    commitment = _split_commitment(x_train, x_validation, x_holdout, seed=seed)
    return DatasetSplits(
        x_train=x_train,
        x_validation=x_validation,
        x_holdout=x_holdout,
        y_train=y_train,
        y_validation=y_validation,
        y_holdout=y_holdout,
        harmonized_columns=metadata,
        dropped_columns=dropped_columns,
        split_commitment=commitment,
    )


def zeroize_frame(frame: pd.DataFrame) -> None:
    """Best-effort overwrite of owned numeric/object arrays before enclave teardown."""
    for column in frame.columns:
        try:
            if pd.api.types.is_numeric_dtype(frame[column]):
                frame.loc[:, column] = np.nan
            else:
                frame.loc[:, column] = ""
        except (TypeError, ValueError):
            pass

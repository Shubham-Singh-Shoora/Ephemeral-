"""Tabular clinical parsing and conservative unit harmonization.

The filename is retained from the accepted repository architecture. The mapper
does not claim that a source dataset is OMOP or FHIR compliant; it emits a
small, explicit metadata mapping for downstream audit.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np
import pandas as pd


AGE_PATTERN = re.compile(
    r"(?:(?P<years>\d+(?:\.\d+)?)\s*(?:y|yr|yrs|year|years))?\s*"
    r"(?:(?P<months>\d+(?:\.\d+)?)\s*(?:m|mo|mos|month|months))?\s*"
    r"(?:(?P<days>\d+(?:\.\d+)?)\s*(?:d|day|days))?",
    re.IGNORECASE,
)

LAB_CONCEPTS = {
    "hba0": ("Ephemeral:HbA0", "%"),
    "hba2": ("LOINC:4551-8", "%"),
    "hbf": ("LOINC:4576-5", "%"),
    "rbc": ("LOINC:789-8", "10^12/L"),
    "hb": ("LOINC:718-7", "g/dL"),
    "mcv": ("LOINC:787-2", "fL"),
    "mch": ("LOINC:785-6", "pg"),
    "mchc": ("LOINC:786-4", "g/dL"),
    "rdwcv": ("LOINC:788-0", "%"),
    "swindow": ("Ephemeral:SWindow", "%"),
}


@dataclass(frozen=True)
class HarmonizedColumn:
    source_name: str
    normalized_name: str
    concept: str | None
    unit: str | None


def normalize_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def parse_age_years(value: object) -> float:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return np.nan
    text = str(value).strip()
    if not text:
        return np.nan
    try:
        numeric = float(text)
        return numeric if numeric >= 0 else np.nan
    except ValueError:
        pass
    match = AGE_PATTERN.fullmatch(text)
    if not match or not any(match.groupdict().values()):
        return np.nan
    years = float(match.group("years") or 0)
    months = float(match.group("months") or 0)
    days = float(match.group("days") or 0)
    return years + months / 12.0 + days / 365.25


def parse_numeric(value: object) -> float:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return np.nan
    text = str(value).strip().replace(",", "")
    if not text:
        return np.nan
    match = re.search(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?", text, re.IGNORECASE)
    return float(match.group(0)) if match else np.nan


def harmonize_tabular(frame: pd.DataFrame) -> tuple[pd.DataFrame, list[HarmonizedColumn]]:
    result = frame.copy(deep=True)
    metadata: list[HarmonizedColumn] = []
    for column in result.columns:
        normalized = normalize_name(str(column))
        concept, unit = LAB_CONCEPTS.get(normalized, (None, None))
        if normalized == "age" or normalized.endswith("ageyears"):
            result[column] = result[column].map(parse_age_years).astype("float32")
        elif normalized in LAB_CONCEPTS:
            result[column] = result[column].map(parse_numeric).astype("float32")
        metadata.append(HarmonizedColumn(str(column), normalized, concept, unit))
    return result, metadata

"""Stage 2: build a ColumnTransformer from training data and model profile."""

from __future__ import annotations

from typing import Literal

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, StandardScaler


ModelProfile = Literal["linear_or_distance", "tree_ensemble", "deep_vision_monai", "custom_sklearn_pipeline"]


def _one_hot_encoder():
    try:
        return OneHotEncoder(drop="first", handle_unknown="ignore", sparse_output=False)
    except TypeError:  # scikit-learn < 1.2 compatibility for controlled deployments
        return OneHotEncoder(drop="first", handle_unknown="ignore", sparse=False)


def build_preprocessor(
    x_train: pd.DataFrame,
    profile: ModelProfile,
    model_family: str,
) -> ColumnTransformer:
    if profile == "deep_vision_monai":
        raise ValueError("deep_vision_monai uses the DICOM volume pipeline, not a tabular ColumnTransformer")
    if profile == "custom_sklearn_pipeline":
        raise ValueError("Custom executable pipelines require a separately attested allowlisted runner")

    numeric_columns = x_train.select_dtypes(include=["number", "bool"]).columns.tolist()
    categorical_columns = [column for column in x_train.columns if column not in numeric_columns]
    transformers = []

    if profile == "linear_or_distance":
        if numeric_columns:
            transformers.append(("numeric", Pipeline([
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
            ]), numeric_columns))
        if categorical_columns:
            transformers.append(("categorical", Pipeline([
                ("imputer", SimpleImputer(strategy="most_frequent")),
                ("one_hot", _one_hot_encoder()),
            ]), categorical_columns))
    elif profile == "tree_ensemble":
        native_missing = any(name in model_family.lower() for name in ("xgboost", "lightgbm"))
        if numeric_columns:
            numeric_transformer = "passthrough" if native_missing else SimpleImputer(strategy="median", add_indicator=True)
            transformers.append(("numeric", numeric_transformer, numeric_columns))
        if categorical_columns:
            transformers.append(("categorical", Pipeline([
                ("imputer", SimpleImputer(strategy="most_frequent")),
                ("ordinal", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)),
            ]), categorical_columns))
    else:
        raise ValueError(f"Unsupported model profile: {profile}")

    if not transformers:
        raise ValueError("No usable feature columns remain after privacy filtering")
    return ColumnTransformer(transformers=transformers, remainder="drop", verbose_feature_names_out=True)

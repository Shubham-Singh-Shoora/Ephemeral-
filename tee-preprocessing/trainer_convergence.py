"""Bounded, validation-driven tuning with a one-time holdout audit."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.metrics import accuracy_score, f1_score, mean_squared_error, roc_auc_score
from sklearn.multioutput import MultiOutputClassifier, MultiOutputRegressor
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.svm import SVC, SVR
from sklearn.linear_model import LogisticRegression, Ridge

from stage1_sanitization import DatasetSplits, TaskType
from stage2_adaptive_profiles import ModelProfile, build_preprocessor


Metric = Literal["f1_macro", "roc_auc", "accuracy", "rmse"]


@dataclass(frozen=True)
class TrialMetric:
    trial: int
    train_score: float
    validation_score: float
    overfit_gap: float
    adjustment: str


@dataclass
class ConvergenceResult:
    pipeline: Pipeline
    train_score: float
    validation_score: float
    holdout_score: float
    overfit_gap: float
    validation_converged: bool
    holdout_passed: bool
    trials: list[TrialMetric]
    metric: Metric


def _single_target(y: pd.DataFrame):
    return y.iloc[:, 0] if y.shape[1] == 1 else y


def _is_multi_target(y: pd.DataFrame) -> bool:
    return y.shape[1] > 1


def _model_kind(task_types: dict[str, TaskType]) -> TaskType:
    kinds = set(task_types.values())
    if len(kinds) != 1:
        raise ValueError("Mixed classification/regression targets require separate metric policies and are not accepted in one job")
    return next(iter(kinds))


def _tree_estimator(family: str, kind: TaskType, seed: int, params: dict[str, Any]) -> BaseEstimator:
    normalized = family.lower()
    if "xgboost" in normalized:
        try:
            from xgboost import XGBClassifier, XGBRegressor
        except ImportError as exc:
            raise RuntimeError("xgboost was selected but is not installed in the enclave image") from exc
        cls = XGBClassifier if kind == "classification" else XGBRegressor
        common = {"random_state": seed, "n_jobs": 1, "n_estimators": params["n_estimators"], "max_depth": params["max_depth"]}
        if kind == "classification":
            common.update({"eval_metric": "mlogloss"})
        return cls(**common)
    if "lightgbm" in normalized:
        try:
            from lightgbm import LGBMClassifier, LGBMRegressor
        except ImportError as exc:
            raise RuntimeError("LightGBM was selected but is not installed in the enclave image") from exc
        cls = LGBMClassifier if kind == "classification" else LGBMRegressor
        return cls(
            random_state=seed,
            n_jobs=1,
            n_estimators=params["n_estimators"],
            max_depth=params["max_depth"],
            min_child_samples=params["min_samples_leaf"],
            verbosity=-1,
        )
    if "catboost" in normalized:
        try:
            from catboost import CatBoostClassifier, CatBoostRegressor
        except ImportError as exc:
            raise RuntimeError("CatBoost was selected but is not installed in the enclave image") from exc
        cls = CatBoostClassifier if kind == "classification" else CatBoostRegressor
        return cls(
            random_seed=seed,
            iterations=params["n_estimators"],
            depth=min(params["max_depth"], 12),
            verbose=False,
            thread_count=1,
            auto_class_weights="Balanced" if kind == "classification" else None,
        )
    cls = RandomForestClassifier if kind == "classification" else RandomForestRegressor
    extra = {"class_weight": "balanced_subsample"} if kind == "classification" else {}
    return cls(
        n_estimators=params["n_estimators"],
        max_depth=params["max_depth"],
        min_samples_leaf=params["min_samples_leaf"],
        max_features=params["max_features"],
        random_state=seed,
        n_jobs=1,
        **extra,
    )


def _linear_estimator(family: str, kind: TaskType, seed: int, params: dict[str, Any]) -> BaseEstimator:
    normalized = family.lower()
    if "knn" in normalized or "neighbor" in normalized:
        cls = KNeighborsClassifier if kind == "classification" else KNeighborsRegressor
        return cls(n_neighbors=params["n_neighbors"], weights="distance")
    if "svm" in normalized or "svc" in normalized or "svr" in normalized:
        if kind == "classification":
            return SVC(C=params["c"], class_weight="balanced", probability=True, random_state=seed)
        return SVR(C=params["c"])
    if "mlp" in normalized or "neural" in normalized:
        cls = MLPClassifier if kind == "classification" else MLPRegressor
        return cls(
            hidden_layer_sizes=params["hidden_layers"],
            alpha=params["alpha"],
            max_iter=400,
            early_stopping=True,
            random_state=seed,
        )
    if kind == "classification":
        return LogisticRegression(C=params["c"], class_weight="balanced", max_iter=1000, random_state=seed)
    return Ridge(alpha=1.0 / max(params["c"], 1e-6), random_state=seed)


def _candidate_params(trial: int, adjustment: str) -> dict[str, Any]:
    if adjustment == "regularize":
        strength = trial + 1
        return {
            "n_estimators": min(150 + 25 * trial, 500),
            "max_depth": max(3, 10 - strength),
            "min_samples_leaf": min(2 + strength, 12),
            "max_features": max(0.35, 0.8 - 0.05 * strength),
            "c": max(0.01, 1.0 / (1 + strength)),
            "n_neighbors": min(5 + 2 * strength, 31),
            "hidden_layers": (64,),
            "alpha": min(0.1, 0.001 * (2 ** strength)),
        }
    if adjustment == "capacity":
        return {
            "n_estimators": min(150 + 50 * trial, 600),
            "max_depth": min(6 + trial, 18),
            "min_samples_leaf": 1,
            "max_features": min(1.0, 0.7 + 0.03 * trial),
            "c": min(50.0, 1.0 + trial * 1.5),
            "n_neighbors": max(1, 7 - trial),
            "hidden_layers": (min(256, 64 + 16 * trial), min(128, 32 + 8 * trial)),
            "alpha": max(1e-6, 0.0001 / (trial + 1)),
        }
    return {
        "n_estimators": 150,
        "max_depth": 8,
        "min_samples_leaf": 2,
        "max_features": 0.7,
        "c": 1.0,
        "n_neighbors": 5,
        "hidden_layers": (64, 32),
        "alpha": 0.0001,
    }


def _wrap_multi_output(estimator: BaseEstimator, kind: TaskType, y: pd.DataFrame) -> BaseEstimator:
    if not _is_multi_target(y):
        return estimator
    return MultiOutputClassifier(estimator, n_jobs=1) if kind == "classification" else MultiOutputRegressor(estimator, n_jobs=1)


def _probabilities(estimator: BaseEstimator, x) -> list[np.ndarray]:
    if not hasattr(estimator, "predict_proba"):
        raise ValueError("ROC AUC requires an estimator with predict_proba")
    probabilities = estimator.predict_proba(x)
    return probabilities if isinstance(probabilities, list) else [probabilities]


def _classification_score(metric: Metric, estimator: BaseEstimator, x, y: pd.DataFrame) -> float:
    expected = y.to_numpy()
    predicted = np.asarray(estimator.predict(x))
    if expected.shape[1] == 1:
        expected = expected[:, 0]
        predicted = predicted.reshape(-1)
    if metric == "accuracy":
        return float(accuracy_score(expected, predicted))
    if metric == "f1_macro":
        if y.shape[1] == 1:
            return float(f1_score(expected, predicted, average="macro", zero_division=0))
        return float(np.mean([
            f1_score(expected[:, index], predicted[:, index], average="macro", zero_division=0)
            for index in range(y.shape[1])
        ]))
    if metric == "roc_auc":
        scores = []
        for index, probabilities in enumerate(_probabilities(estimator, x)):
            actual = y.iloc[:, index]
            if probabilities.shape[1] == 2:
                scores.append(roc_auc_score(actual, probabilities[:, 1]))
            else:
                scores.append(roc_auc_score(actual, probabilities, multi_class="ovr", average="macro"))
        return float(np.mean(scores))
    raise ValueError(f"Unsupported classification metric: {metric}")


def _regression_score(estimator: BaseEstimator, x, y: pd.DataFrame) -> float:
    predicted = np.asarray(estimator.predict(x))
    actual = y.to_numpy()
    if actual.shape[1] == 1:
        predicted = predicted.reshape(-1, 1)
    return float(np.sqrt(mean_squared_error(actual, predicted)))


def _score(metric: Metric, kind: TaskType, estimator: BaseEstimator, x, y: pd.DataFrame) -> float:
    return _classification_score(metric, estimator, x, y) if kind == "classification" else _regression_score(estimator, x, y)


def _is_better(metric: Metric, candidate: float, best: float | None) -> bool:
    return best is None or (candidate < best if metric == "rmse" else candidate > best)


def _target_met(metric: Metric, score: float, threshold: float) -> bool:
    return score <= threshold if metric == "rmse" else score >= threshold


def train_with_convergence(
    splits: DatasetSplits,
    model_family: str,
    model_profile: ModelProfile,
    task_types: dict[str, TaskType],
    metric: Metric,
    min_target_score: float,
    max_overfit_gap: float,
    max_trials: int,
    seed: int,
    min_holdout_score: float | None = None,
) -> ConvergenceResult:
    kind = _model_kind(task_types)
    if kind == "classification" and metric == "rmse":
        raise ValueError("RMSE is only valid for regression targets")
    if kind == "regression" and metric != "rmse":
        raise ValueError("Regression jobs currently require RMSE")
    if not 1 <= max_trials <= 25:
        raise ValueError("max_trials must be between 1 and 25")

    preprocessor = build_preprocessor(splits.x_train, model_profile, model_family)
    x_train = preprocessor.fit_transform(splits.x_train, _single_target(splits.y_train))
    x_validation = preprocessor.transform(splits.x_validation)
    adjustment = "baseline"
    best_model: BaseEstimator | None = None
    best_validation: float | None = None
    best_train = 0.0
    best_gap = float("inf")
    trials: list[TrialMetric] = []

    for trial in range(max_trials):
        params = _candidate_params(trial, adjustment)
        base = _tree_estimator(model_family, kind, seed + trial, params) if model_profile == "tree_ensemble" else _linear_estimator(model_family, kind, seed + trial, params)
        estimator = _wrap_multi_output(base, kind, splits.y_train)
        estimator.fit(x_train, _single_target(splits.y_train))
        train_score = _score(metric, kind, estimator, x_train, splits.y_train)
        validation_score = _score(metric, kind, estimator, x_validation, splits.y_validation)
        gap = (validation_score - train_score) if metric == "rmse" else (train_score - validation_score)
        trials.append(TrialMetric(trial + 1, train_score, validation_score, gap, adjustment))

        acceptable_gap = gap <= max_overfit_gap
        if acceptable_gap and _is_better(metric, validation_score, best_validation):
            best_model = estimator
            best_validation = validation_score
            best_train = train_score
            best_gap = gap
        if _target_met(metric, validation_score, min_target_score) and acceptable_gap:
            best_model = estimator
            best_validation = validation_score
            best_train = train_score
            best_gap = gap
            break
        adjustment = "regularize" if not acceptable_gap else "capacity"

    if best_model is None or best_validation is None:
        # Preserve the least-bad validation candidate only for audit and refund decisions.
        raise RuntimeError("Every bounded trial exceeded the overfit-gap policy")

    validation_converged = _target_met(metric, best_validation, min_target_score) and best_gap <= max_overfit_gap
    x_holdout = preprocessor.transform(splits.x_holdout)
    holdout_score = _score(metric, kind, best_model, x_holdout, splits.y_holdout)
    holdout_threshold = min_target_score if min_holdout_score is None else min_holdout_score
    holdout_passed = _target_met(metric, holdout_score, holdout_threshold)
    pipeline = Pipeline([("preprocessor", preprocessor), ("estimator", best_model)])
    return ConvergenceResult(
        pipeline=pipeline,
        train_score=best_train,
        validation_score=best_validation,
        holdout_score=holdout_score,
        overfit_gap=best_gap,
        validation_converged=validation_converged,
        holdout_passed=holdout_passed,
        trials=trials,
        metric=metric,
    )

"""Pre-specified order-effect feasibility tests for the nurses EMA data."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .nurses_poc import (
    MOMENTARY, OUTCOMES, PERSON_TRAITS, TASKS, add_recent_state, load_ema,
)


DECISION_OUTCOMES = ("Problem", "Emotion")


def add_two_lags(frame: pd.DataFrame) -> pd.DataFrame:
    """Add two strictly earlier observations without crossing people."""
    data = frame.sort_values(["Person", "Moment_total"]).reset_index(drop=True).copy()
    grouped = data.groupby("Person", sort=False)
    for lag in (1, 2):
        for column in MOMENTARY + TASKS:
            data[f"lag{lag}_{column}"] = grouped[column].shift(lag)
    return data.dropna(subset=[f"lag2_{MOMENTARY[0]}"]).reset_index(drop=True)


def _current_features(data: pd.DataFrame) -> pd.DataFrame:
    columns = list(MOMENTARY + TASKS + PERSON_TRAITS)
    numeric = data[columns].astype(float).reset_index(drop=True)
    categories = pd.get_dummies(
        data[["Shift", "Hospital", "Gender"]].astype(str),
        prefix=["Shift", "Hospital", "Gender"],
        dtype=float,
    ).reset_index(drop=True)
    return pd.concat([numeric, categories], axis=1)


def _symmetric_momentary(data: pd.DataFrame) -> pd.DataFrame:
    result = {}
    for column in MOMENTARY:
        first = data[f"lag1_{column}"].astype(float)
        second = data[f"lag2_{column}"].astype(float)
        result[f"past_sum_{column}"] = first + second
        result[f"past_absdiff_{column}"] = (first - second).abs()
    return pd.DataFrame(result)


def _linear_order(data: pd.DataFrame, swap: np.ndarray | None = None) -> pd.DataFrame:
    result = {}
    sign = np.where(swap, -1.0, 1.0) if swap is not None else 1.0
    for column in MOMENTARY:
        difference = data[f"lag1_{column}"].astype(float) - data[f"lag2_{column}"].astype(float)
        result[f"order_diff_{column}"] = difference * sign
    return pd.DataFrame(result)


def _commutators(
    data: pd.DataFrame,
    columns: tuple[str, ...],
    swap: np.ndarray | None = None,
) -> pd.DataFrame:
    result = {}
    sign = np.where(swap, -1.0, 1.0) if swap is not None else 1.0
    for index, left in enumerate(columns):
        for right in columns[index + 1:]:
            value = (
                data[f"lag1_{left}"].astype(float) * data[f"lag2_{right}"].astype(float)
                - data[f"lag2_{left}"].astype(float) * data[f"lag1_{right}"].astype(float)
            )
            result[f"commutator_{left}_{right}"] = value * sign
    return pd.DataFrame(result)


def _task_labels(data: pd.DataFrame, lag: int) -> pd.Series:
    values = data[[f"lag{lag}_{column}" for column in TASKS]].astype(int).to_numpy()
    labels = np.full(len(data), "Other", dtype=object)
    single = values.sum(axis=1) == 1
    task_names = np.asarray(TASKS, dtype=object)
    labels[single] = task_names[values[single].argmax(axis=1)]
    return pd.Series(labels)


def _categorical_task_pair(
    data: pd.DataFrame,
    ordered: bool,
    swap: np.ndarray | None = None,
) -> pd.DataFrame:
    first = _task_labels(data, 1).to_numpy()
    second = _task_labels(data, 2).to_numpy()
    if swap is not None:
        first, second = np.where(swap, second, first), np.where(swap, first, second)
    if not ordered:
        pair = np.array(["|".join(sorted(values)) for values in zip(first, second)])
    else:
        pair = np.char.add(np.char.add(first.astype(str), ">"), second.astype(str))
    return pd.get_dummies(pd.Series(pair), prefix="task_pair", dtype=float)


def _auc(features: pd.DataFrame, target: np.ndarray, groups: np.ndarray) -> float:
    probabilities = np.empty(len(target))
    splitter = GroupKFold(n_splits=5)
    for train, test in splitter.split(features, target, groups):
        model = Pipeline([
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
            ("model", LogisticRegression(max_iter=3000, class_weight="balanced", C=0.1)),
        ])
        model.fit(features.iloc[train], target[train])
        probabilities[test] = model.predict_proba(features.iloc[test])[:, 1]
    return float(roc_auc_score(target, probabilities))


def _evaluate_encoding(
    data: pd.DataFrame,
    base: pd.DataFrame,
    order_builder,
    permutations: int,
    seed: int,
    void_fraction: float | None = None,
) -> dict:
    groups = data["Person"].to_numpy()
    ordered = order_builder(None).reset_index(drop=True)
    combined = pd.concat([base, ordered], axis=1)
    zero_fraction = float((ordered.to_numpy() == 0).mean()) if ordered.size else 1.0
    results = {"rows": len(data), "order_features": ordered.shape[1], "zero_fraction": zero_fraction}
    for outcome in DECISION_OUTCOMES:
        target = data[outcome].astype(int).to_numpy()
        propensity = data[[f"propensity_{outcome}"]].reset_index(drop=True)
        outcome_base = pd.concat([base, propensity], axis=1)
        outcome_combined = pd.concat([combined, propensity], axis=1)
        baseline_auc = _auc(outcome_base, target, groups)
        observed_auc = _auc(outcome_combined, target, groups)
        observed = observed_auc - baseline_auc
        rng = np.random.default_rng(seed)
        null = []
        for _ in range(permutations):
            swaps = rng.random(len(data)) < 0.5
            permuted = pd.concat([
                base, order_builder(swaps).reset_index(drop=True), propensity,
            ], axis=1)
            null.append(_auc(permuted, target, groups) - baseline_auc)
        null_array = np.asarray(null)
        p_value = float((1 + np.count_nonzero(null_array >= observed)) / (permutations + 1))
        verdict = "order-supported" if observed > 0 and p_value <= 0.05 else "null"
        if void_fraction is not None and zero_fraction >= void_fraction:
            verdict = "void"
        results[outcome] = {
            "baseline_auc": baseline_auc,
            "ordered_auc": observed_auc,
            "contribution": observed,
            "permutation_p": p_value,
            "null_mean": float(null_array.mean()),
            "verdict": verdict,
        }
    return results


def evaluate_order(frame: pd.DataFrame, permutations: int = 200, seed: int = 870) -> dict:
    missingness_patterns = int(frame.isna().astype(int).drop_duplicates().shape[0])
    missing_cells = int(frame.isna().sum().sum())
    refusal_by_person = frame.groupby("Person")["Refusal"].sum().sort_values(ascending=False)
    data = add_two_lags(add_recent_state(frame))
    current = _current_features(data)
    symmetric = _symmetric_momentary(data)
    momentary_base = pd.concat([current, symmetric], axis=1)

    unordered_tasks = _categorical_task_pair(data, ordered=False).reset_index(drop=True)
    task_base = pd.concat([current, unordered_tasks], axis=1)
    differing_tasks = int((_task_labels(data, 1) != _task_labels(data, 2)).sum())

    return {
        "rows": len(data),
        "people": int(data["Person"].nunique()),
        "permutations": permutations,
        "seed": seed,
        "momentary_linear": _evaluate_encoding(
            data, momentary_base, lambda swap: _linear_order(data, swap), permutations, seed,
        ),
        "momentary_commutator": _evaluate_encoding(
            data, momentary_base,
            lambda swap: _commutators(data, MOMENTARY, swap), permutations, seed + 1,
        ),
        "task_commutator": _evaluate_encoding(
            data, task_base,
            lambda swap: _commutators(data, TASKS, swap), permutations, seed + 2,
            void_fraction=0.90,
        ),
        "task_categorical": {
            "different_preceding_tasks": differing_tasks,
            "unordered_levels": unordered_tasks.shape[1],
            "ordered_levels": _categorical_task_pair(data, ordered=True).shape[1],
            **_evaluate_encoding(
                data, task_base,
                lambda swap: _categorical_task_pair(data, ordered=True, swap=swap),
                permutations, seed + 3,
            ),
        },
        "scope": {
            "Refusal": {
                "status": "not assessed",
                "positive_rows": int(frame["Refusal"].sum()),
                "people_with_positive": int((refusal_by_person > 0).sum()),
                "largest_person_count": int(refusal_by_person.iloc[0]),
                "top_five_people_count": int(refusal_by_person.iloc[:5].sum()),
                "reason": "rare and concentrated across participants",
            },
            "interference": {
                "status": "not testable",
                "missing_cells": missing_cells,
                "missingness_patterns": missingness_patterns,
                "reason": "every variable is jointly observed at every prompt",
            },
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("data", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--permutations", type=int, default=200)
    parser.add_argument("--seed", type=int, default=870)
    args = parser.parse_args()
    result = evaluate_order(load_ema(args.data), args.permutations, args.seed)
    rendered = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n")
    print(rendered)


if __name__ == "__main__":
    main()

"""Leakage-resistant proof of concept on the nurses coping EMA dataset.

This module does not claim a quantum mechanism.  It tests the prerequisite for
one: whether interactions among momentary context and recent state improve
out-of-person prediction beyond an additive context model.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyreadr
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, PolynomialFeatures, StandardScaler


OUTCOMES = ("Problem", "Emotion", "Support", "Refusal")
MOMENTARY = ("Mood", "Fatigue", "Demand", "Effort", "Control", "Reward")
TASKS = ("Medic", "Docum", "Social", "IndCare", "Communic", "DirCare")
PERSON_TRAITS = (
    "social_support", "emotional_support", "active_coping", "planning_coping",
    "focusing_coping", "acceptance_coping", "denial_coping",
    "positive_reinterpretation", "distraction_coping", "refusal_coping",
)


def load_ema(path: str | Path) -> pd.DataFrame:
    """Load and normalize the public Dryad RData file."""
    objects = pyreadr.read_r(str(path))
    if "eco2" not in objects:
        raise ValueError("Expected an R object named 'eco2'")
    frame = objects["eco2"].copy()
    for column in OUTCOMES + TASKS:
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    return frame.sort_values(["Person", "Moment_total"]).reset_index(drop=True)


def add_recent_state(frame: pd.DataFrame) -> pd.DataFrame:
    """Add only past-within-person observations; never borrow across people."""
    augmented = frame.copy()
    grouped = augmented.groupby("Person", sort=False)
    for column in MOMENTARY + OUTCOMES:
        augmented[f"previous_{column}"] = grouped[column].shift(1)
    return augmented


def _pipeline(feature_set: str) -> tuple[Pipeline, list[str]]:
    current = list(MOMENTARY + TASKS)
    recent = [f"previous_{column}" for column in MOMENTARY + OUTCOMES]
    traits = list(PERSON_TRAITS)
    categorical = ["Shift", "Hospital", "Gender"]

    specifications = {
        "additive": (current, 1),
        "context_interactions": (current, 2),
        "recent_state": (current + recent, 1),
        "context_state": (current + recent, 2),
    }
    if feature_set not in specifications:
        raise ValueError(f"Unknown feature set: {feature_set}")
    dynamic, degree = specifications[feature_set]

    dynamic_steps = [("impute", SimpleImputer(strategy="median"))]
    if degree == 2:
        dynamic_steps.append((
            "interactions",
            PolynomialFeatures(degree=2, interaction_only=True, include_bias=False),
        ))
    dynamic_steps.append(("scale", StandardScaler()))

    transform = ColumnTransformer([
        ("dynamic", Pipeline(dynamic_steps), dynamic),
        ("traits", Pipeline([
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
        ]), traits),
        ("categorical", OneHotEncoder(handle_unknown="ignore"), categorical),
    ])
    model = Pipeline([
        ("features", transform),
        ("classifier", LogisticRegression(max_iter=3000, class_weight="balanced", C=0.1)),
    ])
    return model, dynamic + traits + categorical


def evaluate(frame: pd.DataFrame, folds: int = 5) -> dict:
    """Compare models using held-out people, not randomly held-out rows."""
    data = add_recent_state(frame)
    groups = data["Person"].to_numpy()
    splitter = GroupKFold(n_splits=folds)
    results = {
        "rows": int(len(data)),
        "people": int(data["Person"].nunique()),
        "validation": f"{folds}-fold GroupKFold by Person",
        "models": {},
    }
    for outcome in OUTCOMES:
        target = data[outcome].astype(int).to_numpy()
        prevalence = float(target.mean())
        outcome_result = {"prevalence": prevalence}
        feature_sets = ("additive", "context_interactions", "recent_state", "context_state")
        for feature_set in feature_sets:
            model, columns = _pipeline(feature_set)
            probabilities = cross_val_predict(
                model,
                data[columns],
                target,
                groups=groups,
                cv=splitter,
                method="predict_proba",
            )[:, 1]
            outcome_result[feature_set] = {
                "roc_auc": float(roc_auc_score(target, probabilities)),
                "average_precision": float(average_precision_score(target, probabilities)),
                "brier": float(brier_score_loss(target, probabilities)),
            }
        outcome_result["difference_from_additive"] = {
            feature_set: {
                metric: outcome_result[feature_set][metric] - outcome_result["additive"][metric]
                for metric in ("roc_auc", "average_precision", "brier")
            }
            for feature_set in feature_sets[1:]
        }
        results["models"][outcome] = outcome_result
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("data", type=Path, help="Path to eco2.RData")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = evaluate(load_ema(args.data))
    rendered = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n")
    print(rendered)


if __name__ == "__main__":
    main()

"""Leakage-resistant proof of concept on the nurses coping EMA dataset.

This module does not claim a quantum mechanism.  It tests the prerequisite for
one: whether interactions among momentary context and recent state improve
out-of-person prediction beyond an additive context model.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyreadr
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import GridSearchCV, GroupKFold
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
    """Add only past-within-person observations; never borrow across people.

    Three kinds of history are built separately, because they answer different
    questions and only the decomposition tells them apart:

    ``previous_<momentary>``  the person's preceding mood, fatigue, demand,
                              effort, control and reward — genuine recent state.
    ``previous_<outcome>``    the person's preceding coping choice.
    ``propensity_<outcome>``  the running mean of that person's OWN PAST choices
                              (shifted first, so the current row is excluded).

    The third is a person-level base rate rather than a momentary quantity. It is
    included so that a gain from knowing "this person usually copes this way" is
    not reported as evidence of recent cognitive state.
    """
    augmented = frame.copy()
    grouped = augmented.groupby("Person", sort=False)
    for column in MOMENTARY + OUTCOMES:
        augmented[f"previous_{column}"] = grouped[column].shift(1)
    for column in OUTCOMES:
        augmented[f"propensity_{column}"] = grouped[column].transform(
            lambda series: series.shift(1).expanding().mean()
        )
    return augmented


def _pipeline(feature_set: str, outcome: str) -> tuple[Pipeline, list[str]]:
    current = list(MOMENTARY + TASKS)
    recent_momentary = [f"previous_{column}" for column in MOMENTARY]
    recent = [f"previous_{column}" for column in MOMENTARY + OUTCOMES]
    traits = list(PERSON_TRAITS)
    categorical = ["Shift", "Hospital", "Gender"]

    # recent_state mixes two very different things: the preceding momentary state
    # and the preceding choice of the outcome being predicted. The two sets below
    # separate them, because the shipped comparison could not.
    specifications = {
        # tasks_only and propensity_only are the baselines the first run lacked.
        # Without them the two quantities the README wanted to report -- what the
        # momentary variables add, and what they add *on top of* the person's base
        # rate -- are not computable from this module at all.
        # The third element says whether the shared person-level block (stable
        # coping traits, Shift/Hospital/Gender) is included. The two baselines set
        # it False so they are genuinely minimal: "propensity_only" must be the
        # person's own base rate ALONE, or it is not the baseline the withdrawn
        # claim needed.
        "tasks_only": (list(TASKS), 1, False),
        "propensity_only": ([f"propensity_{outcome}"], 1, False),
        "additive": (current, 1, True),
        "context_interactions": (current, 2, True),
        "recent_momentary": (current + recent_momentary, 1, True),
        "own_history": (current + [f"propensity_{outcome}"], 1, True),
        "recent_state": (current + recent, 1, True),
        "context_state": (current + recent, 2, True),
    }
    if feature_set not in specifications:
        raise ValueError(f"Unknown feature set: {feature_set}")
    dynamic, degree, with_person_block = specifications[feature_set]

    dynamic_steps = [("impute", SimpleImputer(strategy="median"))]
    if degree == 2:
        dynamic_steps.append((
            "interactions",
            PolynomialFeatures(degree=2, interaction_only=True, include_bias=False),
        ))
    dynamic_steps.append(("scale", StandardScaler()))

    blocks = [("dynamic", Pipeline(dynamic_steps), dynamic)]
    if with_person_block:
        blocks.append(("traits", Pipeline([
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
        ]), traits))
        blocks.append(("categorical", OneHotEncoder(handle_unknown="ignore"), categorical))
    transform = ColumnTransformer(blocks)
    model = Pipeline([
        ("features", transform),
        ("classifier", LogisticRegression(max_iter=3000, class_weight="balanced")),
    ])
    columns = dynamic + (traits + categorical if with_person_block else [])
    return model, columns


# A single fixed C penalised these models unequally: `additive` carries ~22
# dynamic features while `context_state` expands to ~231 interactions, so one
# shrinkage strength shrank the interaction models far harder and biased the
# comparison against them. C is now chosen inside each training fold.
C_GRID = (0.003, 0.01, 0.03, 0.1, 0.3, 1.0, 3.0)


def _tuned(model, features, target, groups):
    """Select C by inner GroupKFold on the training data only."""
    inner = GroupKFold(n_splits=3)
    search = GridSearchCV(
        model, {"classifier__C": list(C_GRID)}, scoring="roc_auc",
        cv=inner.split(features, target, groups), n_jobs=1, refit=True,
    )
    search.fit(features, target)
    return search.best_estimator_, float(search.best_params_["classifier__C"])


FEATURE_SETS = (
    "tasks_only", "propensity_only", "additive", "context_interactions",
    "recent_momentary", "own_history", "recent_state", "context_state",
)
BOOTSTRAP_DRAWS = 2000
BOOTSTRAP_SEED = 20260914


def _oof_predictions(data, columns, target, groups, splitter, outcome):
    """Out-of-fold probabilities, plus the per-fold AUC and chosen C.

    The folds are returned so later comparisons can be paired: two models scored
    on different splits are not comparable, and a difference of pooled AUCs hides
    that. Everything downstream uses these same fold assignments.
    """
    probabilities = np.empty(len(target), dtype=float)
    per_fold, chosen_c, fold_index = [], [], np.empty(len(target), dtype=int)
    frame = data[columns]
    for fold, (train, test) in enumerate(splitter.split(frame, target, groups)):
        model, _ = _pipeline_for(columns, outcome)
        fitted, best_c = _tuned(model, frame.iloc[train], target[train], groups[train])
        probabilities[test] = fitted.predict_proba(frame.iloc[test])[:, 1]
        fold_index[test] = fold
        chosen_c.append(best_c)
        per_fold.append(float(roc_auc_score(target[test], probabilities[test]))
                        if len(np.unique(target[test])) > 1 else float("nan"))
    return probabilities, per_fold, chosen_c, fold_index


def _pipeline_for(columns, outcome):
    """Rebuild a pipeline for an explicit column list (used by the fold loop)."""
    for name in FEATURE_SETS:
        model, cols = _pipeline(name, outcome)
        if cols == columns:
            return model, cols
    raise ValueError("unknown column list")


def _person_bootstrap(target, probabilities, people, draws, seed):
    """Resample PEOPLE, not rows.

    1,901 observations come from 96 participants, roughly 20 each. Resampling
    rows would treat those as 1,901 independent facts and understate the interval
    by the design effect, which at an intraclass correlation of 0.1 to 0.3 is
    between 2.9 and 6.6.
    """
    rng = np.random.default_rng(seed)
    unique = np.unique(people)
    index_by_person = {person: np.flatnonzero(people == person) for person in unique}
    values = []
    for _ in range(draws):
        drawn = rng.choice(unique, size=len(unique), replace=True)
        rows = np.concatenate([index_by_person[person] for person in drawn])
        if len(np.unique(target[rows])) < 2:
            continue
        values.append(roc_auc_score(target[rows], probabilities[rows]))
    if not values:
        return None
    return [float(np.percentile(values, 2.5)), float(np.percentile(values, 97.5))]


def _paired_difference(target, probabilities, reference, people, draws, seed):
    """Bootstrap the DIFFERENCE on the same resampled people and the same folds."""
    rng = np.random.default_rng(seed)
    unique = np.unique(people)
    index_by_person = {person: np.flatnonzero(people == person) for person in unique}
    values = []
    for _ in range(draws):
        drawn = rng.choice(unique, size=len(unique), replace=True)
        rows = np.concatenate([index_by_person[person] for person in drawn])
        if len(np.unique(target[rows])) < 2:
            continue
        values.append(roc_auc_score(target[rows], probabilities[rows])
                      - roc_auc_score(target[rows], reference[rows]))
    if not values:
        return None
    values = np.asarray(values)
    lower, upper = np.percentile(values, [2.5, 97.5])
    return {
        "mean": float(values.mean()),
        "ci95": [float(lower), float(upper)],
        "excludes_zero": bool(lower > 0 or upper < 0),
    }


def evaluate(frame, folds=5, draws=BOOTSTRAP_DRAWS, seed=BOOTSTRAP_SEED):
    """Compare models on held-out people, with grouped uncertainty throughout."""
    data = add_recent_state(frame)
    groups = data["Person"].to_numpy()
    splitter = GroupKFold(n_splits=folds)
    results = {
        "rows": int(len(data)),
        "people": int(data["Person"].nunique()),
        "validation": f"{folds}-fold GroupKFold by Person",
        "uncertainty": {
            "method": "participant bootstrap: people resampled with replacement, "
                      "never rows",
            "draws": draws,
            "seed": seed,
            "paired": "differences are bootstrapped on the same resampled people "
                      "and the same fold assignments as the reference model",
        },
        "regularization": {
            "grid": list(C_GRID),
            "selection": "inner 3-fold GroupKFold on training folds only; the test "
                         "fold is never seen during selection",
        },
        "metrics_note": "Brier is omitted: every model uses class_weight='balanced', "
                        "which deliberately decalibrates predicted probabilities, so a "
                        "Brier score computed from them is not a calibration measure.",
        "models": {},
    }
    for outcome in OUTCOMES:
        target = data[outcome].astype(int).to_numpy()
        outcome_result = {"prevalence": float(target.mean())}
        predictions = {}
        for feature_set in FEATURE_SETS:
            _, columns = _pipeline(feature_set, outcome)
            probabilities, per_fold, chosen_c, _ = _oof_predictions(
                data, columns, target, groups, splitter, outcome)
            predictions[feature_set] = probabilities
            outcome_result[feature_set] = {
                "roc_auc": float(roc_auc_score(target, probabilities)),
                "average_precision": float(average_precision_score(target, probabilities)),
                "roc_auc_per_fold": per_fold,
                "roc_auc_fold_mean": float(np.nanmean(per_fold)),
                "roc_auc_fold_sd": float(np.nanstd(per_fold, ddof=1)),
                "roc_auc_ci95_person_bootstrap": _person_bootstrap(
                    target, probabilities, groups, draws, seed),
                "selected_C_per_fold": chosen_c,
            }
        outcome_result["paired_differences"] = {
            reference: {
                feature_set: _paired_difference(
                    target, predictions[feature_set], predictions[reference],
                    groups, draws, seed)
                for feature_set in FEATURE_SETS if feature_set != reference
            }
            for reference in ("additive", "propensity_only")
        }
        results["models"][outcome] = outcome_result
    return results


def dataset_fingerprint(path):
    """Record which file produced a result.

    The archived Dryad file is not redistributable through this repository, so a
    reader cannot diff the input. A checksum is the next best thing: it says
    exactly which bytes these numbers came from.
    """
    digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    return {
        "file": Path(path).name,
        "sha256": digest,
        "source": "Dryad doi:10.5061/dryad.ns1rn8pqv (CC0)",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("data", type=Path, help="Path to eco2.RData")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--draws", type=int, default=BOOTSTRAP_DRAWS)
    args = parser.parse_args()
    frame = load_ema(args.data)
    result = evaluate(frame, draws=args.draws)
    result["dataset"] = dataset_fingerprint(args.data)
    result["participants"] = {
        "in_archived_file": int(frame["Person"].nunique()),
        "reported_recruited_in_publication": 113,
        "note": "The archived file contains fewer participants than the publication "
                "reports recruited. This module applies NO participant exclusions -- "
                "load_ema sorts and type-checks only -- so the difference is a "
                "property of the Dryad deposit, not of this analysis. The deposit "
                "does not document which participants were withheld or why, so the "
                "shortfall cannot be attributed here and the sample should be "
                "treated as the archived subset rather than the recruited cohort.",
    }
    rendered = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n")
    print(rendered)


if __name__ == "__main__":
    main()

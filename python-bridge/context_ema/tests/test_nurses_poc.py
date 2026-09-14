import numpy as np
import pandas as pd
import pytest

from context_ema.nurses_poc import MOMENTARY, OUTCOMES, _pipeline, add_recent_state


def test_recent_state_never_crosses_person_boundaries():
    rows = []
    for person, mood in [(1, 2.0), (2, 5.0)]:
        for moment in (1, 2):
            row = {"Person": person, "Moment_total": moment, "Mood": mood + moment}
            row.update({column: float(moment) for column in ("Fatigue", "Demand", "Effort", "Control", "Reward")})
            row.update({outcome: moment % 2 for outcome in OUTCOMES})
            rows.append(row)
    result = add_recent_state(pd.DataFrame(rows))
    first_rows = result.groupby("Person", sort=False).head(1)
    assert first_rows["previous_Mood"].isna().all()
    assert np.isnan(first_rows["previous_Problem"]).all()
    assert result.loc[1, "previous_Mood"] == 3.0
    assert result.loc[3, "previous_Mood"] == 6.0


def test_propensity_uses_only_that_persons_earlier_rows():
    """The base rate must never see the current row, or it leaks the answer."""
    rows = []
    for person, values in [(1, [1, 1, 0, 1]), (2, [0, 0, 1, 0])]:
        for moment, value in enumerate(values, start=1):
            row = {"Person": person, "Moment_total": moment, "Mood": 1.0}
            row.update({column: 1.0 for column in ("Fatigue", "Demand", "Effort", "Control", "Reward")})
            row.update({outcome: value for outcome in OUTCOMES})
            rows.append(row)
    result = add_recent_state(pd.DataFrame(rows))

    person_one = result[result["Person"] == 1]["propensity_Problem"].tolist()
    assert np.isnan(person_one[0]), "no history exists before the first moment"
    assert person_one[1] == 1.0          # mean of [1]
    assert person_one[2] == 1.0          # mean of [1, 1]
    assert person_one[3] == pytest.approx(2 / 3)   # mean of [1, 1, 0]

    person_two = result[result["Person"] == 2]["propensity_Problem"].tolist()
    assert np.isnan(person_two[0])
    assert person_two[3] == pytest.approx(1 / 3)   # mean of [0, 0, 1], not person 1's


def test_the_feature_sets_separate_recent_state_from_own_past_choice():
    """The distinction that the first run could not make.

    ``recent_state`` bundles the preceding momentary state with the preceding
    choice of the very outcome being predicted. Reporting a gain from that bundle
    as evidence about *cognitive state* is only defensible if the two are also
    reported apart, so these two feature sets must stay available.
    """
    _, momentary_columns = _pipeline("recent_momentary", "Problem")
    _, history_columns = _pipeline("own_history", "Problem")

    assert "previous_Mood" in momentary_columns
    assert not any(column.startswith("previous_Problem") for column in momentary_columns), \
        "recent_momentary must not contain the lagged outcome"
    assert "propensity_Problem" in history_columns
    assert not any(column.startswith("previous_") for column in history_columns), \
        "own_history is a base rate, not a lag"

    # own_history is per-outcome, so it must track the outcome it is asked for.
    _, emotion_columns = _pipeline("own_history", "Emotion")
    assert "propensity_Emotion" in emotion_columns
    assert "propensity_Problem" not in emotion_columns


def test_the_two_baselines_the_claims_needed_now_exist():
    """The withdrawn README claimed what momentary variables add, and what they
    add on top of the person's base rate. Both need a model that did not exist."""
    _, tasks_columns = _pipeline("tasks_only", "Problem")
    _, rate_columns = _pipeline("propensity_only", "Problem")

    assert not any(column in tasks_columns for column in MOMENTARY), \
        "tasks_only must exclude the momentary variables it is the baseline for"
    assert rate_columns == ["propensity_Problem"] or set(rate_columns) == {"propensity_Problem"}, \
        "propensity_only must be the base rate alone, not the base rate plus context"


def test_regularization_is_not_a_single_fixed_constant():
    """One fixed C shrank a 22-feature model and a 231-interaction model equally,
    biasing the interaction comparison. C must be selected, not hardcoded."""
    from context_ema.nurses_poc import C_GRID
    model, _ = _pipeline("additive", "Problem")
    assert model.named_steps["classifier"].C == 1.0, "C must be left at the default for tuning"
    assert len(C_GRID) >= 5 and min(C_GRID) < 0.01 < max(C_GRID)


def test_brier_is_not_reported_for_balanced_models():
    """class_weight='balanced' decalibrates by design; a Brier score computed
    from those probabilities is not a calibration measure."""
    import inspect
    from context_ema import nurses_poc
    source = inspect.getsource(nurses_poc)
    assert "brier_score_loss" not in source, \
        "Brier must not be reported while every model uses balanced class weights"


def test_cold_start_models_never_touch_the_held_out_persons_outcomes():
    """GroupKFold alone does not withhold a held-out person's behaviour once
    their own base rate is a feature. The cold-start set must be clean."""
    from context_ema.nurses_poc import COLD_START, WARM_START, uses_held_out_outcomes
    for feature_set in COLD_START:
        assert not uses_held_out_outcomes(feature_set, "Problem"), \
            f"{feature_set} is listed cold-start but consumes the person's own outcomes"
    for feature_set in WARM_START:
        assert uses_held_out_outcomes(feature_set, "Problem"), \
            f"{feature_set} is listed warm-start but uses no outcome history"


def test_every_feature_set_is_assigned_to_exactly_one_regime():
    from context_ema.nurses_poc import COLD_START, FEATURE_SETS, WARM_START
    assert set(COLD_START) | set(WARM_START) == set(FEATURE_SETS)
    assert not set(COLD_START) & set(WARM_START)


def test_readme_model_count_matches_the_code():
    """The README said six while the module defined eight."""
    from pathlib import Path
    from context_ema.nurses_poc import FEATURE_SETS
    text = Path(__file__).resolve().parents[1].joinpath("README.md").read_text(encoding="utf-8")
    assert "**Eight** regularized logistic models" in text
    assert len(FEATURE_SETS) == 8
    assert "Six regularized logistic models are compared:" not in text


def test_history_requirements_count_first_prompts_as_unserved():
    """A person's first row has no prior outcome, so a warm-start feature cannot
    inform it; the output must say how many such rows there are."""
    import numpy as np
    import pandas as pd
    from context_ema.nurses_poc import history_requirements
    frame = pd.DataFrame({"Person": [1, 1, 1, 2, 2], "Moment_total": [1, 2, 3, 1, 2]})
    stats = history_requirements(frame, "Problem")
    assert stats["first_prompt_rows"] == 2
    assert stats["rows_with_at_least_1_prior_observations"] == 3
    assert stats["total_rows"] == 5

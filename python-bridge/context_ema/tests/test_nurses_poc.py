import numpy as np
import pandas as pd
import pytest

from context_ema.nurses_poc import OUTCOMES, _pipeline, add_recent_state


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

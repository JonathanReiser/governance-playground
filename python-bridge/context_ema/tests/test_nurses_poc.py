import numpy as np
import pandas as pd

from context_ema.nurses_poc import OUTCOMES, add_recent_state


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

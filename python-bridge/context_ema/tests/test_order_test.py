import numpy as np
import pandas as pd

from context_ema.nurses_poc import MOMENTARY, OUTCOMES, TASKS
from context_ema.order_test import (
    _categorical_task_pair,
    _commutators,
    _linear_order,
    add_two_lags,
)


def _frame():
    rows = []
    for person in (1, 2):
        for moment in (1, 2, 3):
            row = {"Person": person, "Moment_total": moment}
            row.update({column: float(moment + index) for index, column in enumerate(MOMENTARY)})
            row.update({column: int(index == (moment - 1) % len(TASKS)) for index, column in enumerate(TASKS)})
            row.update({outcome: moment % 2 for outcome in OUTCOMES})
            rows.append(row)
    return pd.DataFrame(rows)


def test_two_lags_do_not_cross_people():
    result = add_two_lags(_frame())
    assert len(result) == 2
    assert set(result["Person"]) == {1, 2}
    assert (result["lag1_Mood"] == 2.0).all()
    assert (result["lag2_Mood"] == 1.0).all()


def test_swapping_reverses_linear_and_commutator_order_features():
    data = add_two_lags(_frame())
    swap = np.ones(len(data), dtype=bool)
    assert np.allclose(_linear_order(data, swap), -_linear_order(data))
    assert np.allclose(_commutators(data, MOMENTARY, swap), -_commutators(data, MOMENTARY))


def test_categorical_task_order_preserves_pair_but_reverses_direction():
    data = add_two_lags(_frame()).iloc[[0]].reset_index(drop=True)
    forward = _categorical_task_pair(data, ordered=True)
    reverse = _categorical_task_pair(data, ordered=True, swap=np.array([True]))
    unordered = _categorical_task_pair(data, ordered=False)
    assert forward.columns.tolist() != reverse.columns.tolist()
    assert unordered.shape == (1, 1)

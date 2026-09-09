import math

import numpy as np
import pytest

from ttt_lab.game import apply_move, initial_state
from ttt_lab.policies.softmax import probabilities, sample_move


def play(*moves):
    state = initial_state()
    for move in moves:
        state = apply_move(state, move)
    return state


def test_zero_temperature_is_greedy_and_infinite_is_uniform():
    state = play(0, 3, 1, 4)
    cold = probabilities(state, 0)
    hot = probabilities(state, math.inf)
    assert dict(zip(cold.moves, cold.probabilities))[2] == 1.0
    assert all(value == pytest.approx(1 / len(hot.moves)) for value in hot.probabilities)
    assert cold.probabilities != hot.probabilities


def test_distribution_is_normalized_legal_and_finite():
    state = play(0, 4)
    decision = probabilities(state, 0.7)
    assert set(decision.moves) == {1, 2, 3, 5, 6, 7, 8}
    assert sum(decision.probabilities) == pytest.approx(1.0, abs=1e-12)
    assert all(math.isfinite(value) and value >= 0 for value in decision.probabilities)


def test_unique_best_move_probability_falls_as_temperature_rises():
    state = play(0, 3, 1, 4)
    probabilities_by_temperature = [
        dict(zip(result.moves, result.probabilities))[2]
        for result in (probabilities(state, 0.1), probabilities(state, 1.0), probabilities(state, 10.0))
    ]
    assert probabilities_by_temperature[0] > probabilities_by_temperature[1] > probabilities_by_temperature[2]


def test_equal_values_receive_equal_probabilities():
    decision = probabilities(play(0, 4, 1), 0.8)
    by_value: dict[int, set[float]] = {}
    for value, probability in zip(decision.values, decision.probabilities):
        by_value.setdefault(value, set()).add(round(probability, 14))
    assert len(by_value) > 1
    assert all(len(group) == 1 for group in by_value.values())


@pytest.mark.parametrize("temperature", [-1, float("nan"), True, "warm"])
def test_invalid_temperature_fails(temperature):
    with pytest.raises(ValueError):
        probabilities(initial_state(), temperature)


def test_seeded_sampling_is_reproducible_and_not_global():
    state = play(0, 4)
    a = np.random.default_rng(123)
    b = np.random.default_rng(123)
    assert [sample_move(state, 0.8, a) for _ in range(30)] == [sample_move(state, 0.8, b) for _ in range(30)]

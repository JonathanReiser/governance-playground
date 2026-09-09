"""A classical stochastic policy over exact minimax action values."""

from __future__ import annotations

from dataclasses import dataclass
import math

import numpy as np

from ttt_lab.game import GameState
from ttt_lab.policies.minimax import action_values


@dataclass(frozen=True, slots=True)
class SoftmaxDecision:
    moves: tuple[int, ...]
    values: tuple[int, ...]
    probabilities: tuple[float, ...]
    temperature: float


def probabilities(state: GameState, temperature: float) -> SoftmaxDecision:
    if isinstance(temperature, bool) or not isinstance(temperature, (int, float)):
        raise ValueError("temperature must be a nonnegative number")
    temperature = float(temperature)
    if math.isnan(temperature) or temperature < 0:
        raise ValueError("temperature must be nonnegative and not NaN")

    by_move = action_values(state)
    moves = tuple(by_move)
    values = tuple(by_move.values())
    if temperature == 0.0:
        best = max(values)
        count = values.count(best)
        probs = tuple(1.0 / count if value == best else 0.0 for value in values)
    elif math.isinf(temperature):
        probs = (1.0 / len(moves),) * len(moves)
    else:
        logits = np.asarray(values, dtype=float) / temperature
        weights = np.exp(logits - np.max(logits))
        probs = tuple(float(value) for value in weights / weights.sum())
    return SoftmaxDecision(moves, values, probs, temperature)


def sample_move(state: GameState, temperature: float, rng: np.random.Generator) -> int:
    decision = probabilities(state, temperature)
    return int(rng.choice(decision.moves, p=decision.probabilities))

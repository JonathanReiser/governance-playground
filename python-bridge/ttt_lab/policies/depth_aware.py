"""A tempo-sensitive classical baseline that preserves outcome ordering."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import math

import numpy as np

from ttt_lab.game import GameState, apply_move, is_terminal, legal_moves, utility


@dataclass(frozen=True, slots=True)
class DepthAwareDecision:
    moves: tuple[int, ...]
    scores: tuple[float, ...]
    probabilities: tuple[float, ...]
    discount: float
    temperature: float


def _validate_discount(discount: float) -> float:
    if isinstance(discount, bool) or not isinstance(discount, (int, float)):
        raise ValueError("discount must be a number in (0, 1]")
    discount = float(discount)
    if math.isnan(discount) or not 0 < discount <= 1:
        raise ValueError("discount must be a number in (0, 1]")
    return discount


@lru_cache(maxsize=None)
def _discounted_value(state: GameState, discount: float) -> float:
    if is_terminal(state):
        return float(utility(state, state.to_move))
    return max(-discount * _discounted_value(apply_move(state, move), discount) for move in legal_moves(state))


def action_scores(state: GameState, discount: float = 0.9) -> dict[int, float]:
    """Score actions as discounted terminal outcomes under optimal continuation.

    A win is always above a draw and a draw above a loss. Within those
    outcome classes, the model prefers earlier wins and later losses.
    """
    discount = _validate_discount(discount)
    if is_terminal(state):
        raise ValueError("a terminal state has no actions")
    return {
        move: -discount * _discounted_value(apply_move(state, move), discount)
        for move in legal_moves(state)
    }


def probabilities(state: GameState, temperature: float, discount: float = 0.9) -> DepthAwareDecision:
    discount = _validate_discount(discount)
    if isinstance(temperature, bool) or not isinstance(temperature, (int, float)):
        raise ValueError("temperature must be a nonnegative number")
    temperature = float(temperature)
    if math.isnan(temperature) or temperature < 0:
        raise ValueError("temperature must be nonnegative and not NaN")
    by_move = action_scores(state, discount)
    moves, scores = tuple(by_move), tuple(by_move.values())
    if temperature == 0:
        best = max(scores)
        count = scores.count(best)
        probs = tuple(1 / count if score == best else 0.0 for score in scores)
    elif math.isinf(temperature):
        probs = (1 / len(moves),) * len(moves)
    else:
        logits = np.asarray(scores) / temperature
        weights = np.exp(logits - np.max(logits))
        probs = tuple(float(value) for value in weights / weights.sum())
    return DepthAwareDecision(moves, scores, probs, discount, temperature)


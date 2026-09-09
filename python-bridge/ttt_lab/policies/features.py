"""Small, interpretable feature policy for comparison with human choices."""

from __future__ import annotations

from dataclasses import dataclass
import math

import numpy as np

from ttt_lab.game import GameState, apply_move, legal_moves, winner

DEFAULT_WEIGHTS = {
    "immediate_win": 6.0,
    "immediate_block": 5.0,
    "creates_fork": 3.0,
    "center": 1.5,
    "corner": 0.8,
}


@dataclass(frozen=True, slots=True)
class FeatureDecision:
    moves: tuple[int, ...]
    features: tuple[tuple[tuple[str, float], ...], ...]
    scores: tuple[float, ...]
    probabilities: tuple[float, ...]


def _winning_moves(state: GameState) -> set[int]:
    player = state.to_move
    return {move for move in legal_moves(state) if winner(apply_move(state, move)) == player}


def move_features(state: GameState, move: int) -> dict[str, float]:
    if move not in legal_moves(state):
        raise ValueError("choice must be a legal move")
    opponent_state = GameState(state.board, -state.to_move)  # counterfactual threat scan
    opponent_wins = _winning_moves(opponent_state)
    child = apply_move(state, move)
    continuation = GameState(child.board, state.to_move)
    return {
        "immediate_win": float(winner(child) == state.to_move),
        "immediate_block": float(move in opponent_wins),
        "creates_fork": float(len(_winning_moves(continuation)) >= 2),
        "center": float(move == 4),
        "corner": float(move in (0, 2, 6, 8)),
    }


def probabilities(
    state: GameState,
    temperature: float = 1.0,
    weights: dict[str, float] | None = None,
) -> FeatureDecision:
    if isinstance(temperature, bool) or not isinstance(temperature, (int, float)):
        raise ValueError("temperature must be positive")
    temperature = float(temperature)
    if math.isnan(temperature) or temperature <= 0:
        raise ValueError("temperature must be positive")
    weights = DEFAULT_WEIGHTS if weights is None else weights
    moves = legal_moves(state)
    if not moves:
        raise ValueError("a terminal state has no actions")
    feature_rows = tuple(move_features(state, move) for move in moves)
    unknown = set(weights) - set(DEFAULT_WEIGHTS)
    if unknown:
        raise ValueError(f"unknown feature weights: {sorted(unknown)}")
    scores = tuple(sum(weights.get(name, 0.0) * value for name, value in row.items()) for row in feature_rows)
    logits = np.asarray(scores) / temperature
    mass = np.exp(logits - np.max(logits))
    probs = tuple(float(value) for value in mass / mass.sum())
    return FeatureDecision(
        moves, tuple(tuple(row.items()) for row in feature_rows), scores, probs
    )


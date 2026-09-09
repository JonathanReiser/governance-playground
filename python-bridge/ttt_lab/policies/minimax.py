"""Exact minimax oracle for ordinary tic-tac-toe."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from ttt_lab.game import GameState, is_terminal, legal_moves, utility, apply_move


@dataclass(frozen=True, slots=True)
class MinimaxDecision:
    value: int
    optimal_moves: tuple[int, ...]
    action_values: tuple[tuple[int, int], ...]


@dataclass(frozen=True, slots=True)
class ChoiceAnalysis:
    move: int
    optimal_moves: tuple[int, ...]
    selected_value: int
    best_value: int
    regret: int
    error_type: str | None


@lru_cache(maxsize=None)
def state_value(state: GameState) -> int:
    if is_terminal(state):
        return utility(state, state.to_move)
    return max(-state_value(apply_move(state, move)) for move in legal_moves(state))


def action_values(state: GameState) -> dict[int, int]:
    if is_terminal(state):
        raise ValueError("a terminal state has no actions")
    return {move: -state_value(apply_move(state, move)) for move in legal_moves(state)}


def analyze(state: GameState) -> MinimaxDecision:
    values = action_values(state)
    best = max(values.values())
    return MinimaxDecision(
        value=best,
        optimal_moves=tuple(move for move, value in values.items() if value == best),
        action_values=tuple(values.items()),
    )


def choose_move(state: GameState) -> int:
    return analyze(state).optimal_moves[0]


def analyze_choice(state: GameState, move: int) -> ChoiceAnalysis:
    decision = analyze(state)
    values = dict(decision.action_values)
    if move not in values:
        raise ValueError("choice must be a legal move")
    selected = values[move]
    regret = decision.value - selected
    error_type = None
    if regret:
        labels = {
            (1, 0): "missed-win-to-draw",
            (1, -1): "missed-win-to-loss",
            (0, -1): "surrendered-draw",
        }
        try:
            error_type = labels[(decision.value, selected)]
        except KeyError as error:
            raise RuntimeError(f"unexpected minimax transition {decision.value} -> {selected}") from error
    return ChoiceAnalysis(move, decision.optimal_moves, selected, decision.value, regret, error_type)

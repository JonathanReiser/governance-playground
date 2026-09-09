"""Pure, immutable tic-tac-toe rules used as the lab's classical ground truth."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Iterator, Literal, TypeAlias

Player: TypeAlias = Literal[-1, 1]
Cell: TypeAlias = Literal[-1, 0, 1]
Board: TypeAlias = tuple[Cell, ...]

X: Player = 1
O: Player = -1
EMPTY: Cell = 0

WINNING_LINES = (
    (0, 1, 2), (3, 4, 5), (6, 7, 8),
    (0, 3, 6), (1, 4, 7), (2, 5, 8),
    (0, 4, 8), (2, 4, 6),
)


@dataclass(frozen=True, slots=True)
class GameState:
    board: Board
    to_move: Player


def initial_state() -> GameState:
    return GameState((EMPTY,) * 9, X)


def _winners(board: Board) -> set[Player]:
    return {
        board[a] for a, b, c in WINNING_LINES
        if board[a] != EMPTY and board[a] == board[b] == board[c]
    }


def winner(state: GameState) -> Player | None:
    winners = _winners(state.board)
    return next(iter(winners)) if len(winners) == 1 else None


def is_terminal(state: GameState) -> bool:
    return bool(_winners(state.board)) or EMPTY not in state.board


def legal_moves(state: GameState) -> tuple[int, ...]:
    if is_terminal(state):
        return ()
    return tuple(index for index, cell in enumerate(state.board) if cell == EMPTY)


def apply_move(state: GameState, move: int) -> GameState:
    if isinstance(move, bool) or not isinstance(move, int):
        raise ValueError("move must be an integer from 0 through 8")
    if move < 0 or move >= 9:
        raise ValueError(f"move {move} is outside the board")
    if is_terminal(state):
        raise ValueError("cannot play after the game is over")
    if state.board[move] != EMPTY:
        raise ValueError(f"square {move} is already occupied")

    board = list(state.board)
    board[move] = state.to_move
    return GameState(tuple(board), -state.to_move)  # type: ignore[arg-type]


def utility(state: GameState, perspective: Player) -> int:
    if not is_terminal(state):
        raise ValueError("utility is defined only for terminal states")
    victor = winner(state)
    if victor is None:
        return 0
    return 1 if victor == perspective else -1


def _rotate(board: Board) -> Board:
    return tuple(board[index] for index in (6, 3, 0, 7, 4, 1, 8, 5, 2))  # type: ignore[return-value]


def _reflect(board: Board) -> Board:
    return tuple(board[index] for index in (2, 1, 0, 5, 4, 3, 8, 7, 6))  # type: ignore[return-value]


def symmetries(board: Board) -> tuple[Board, ...]:
    variants: list[Board] = []
    current = board
    for _ in range(4):
        variants.extend((current, _reflect(current)))
        current = _rotate(current)
    return tuple(variants)


def canonical_key(state: GameState) -> tuple[Board, Player]:
    return min(symmetries(state.board)), state.to_move


@lru_cache(maxsize=1)
def _reachable_state_set() -> frozenset[GameState]:
    found: set[GameState] = set()

    def visit(state: GameState) -> None:
        if state in found:
            return
        found.add(state)
        for move in legal_moves(state):
            visit(apply_move(state, move))

    visit(initial_state())
    return frozenset(found)


def reachable_states() -> Iterator[GameState]:
    yield from sorted(_reachable_state_set(), key=lambda s: (sum(c != EMPTY for c in s.board), s.board))


def validate_state(state: GameState) -> None:
    if not isinstance(state, GameState):
        raise ValueError("expected a GameState")
    if len(state.board) != 9 or any(cell not in (O, EMPTY, X) for cell in state.board):
        raise ValueError("board must contain exactly nine cells from {-1, 0, 1}")
    if state.to_move not in (X, O):
        raise ValueError("to_move must be X (1) or O (-1)")
    if state not in _reachable_state_set():
        raise ValueError("state is not reachable by legal play")

"""The two policies frozen in preregistrations/frozen-policy-payoff-spec.md.

These are the arena's C and D. Everything in quantum_arena/payoffs.py derives
from them, so they are implemented here rather than left as prose — a payoff
matrix nobody can regenerate is a typed-in literal, whatever its provenance note
says.

They differ in EXACTLY one respect: whether the player engages with threats.
Both fall back to the same positional order, so the cost term prices engagement
and nothing else.
"""

from __future__ import annotations

from ttt_lab.game import EMPTY, GameState, X, apply_move, is_terminal, legal_moves, winner

# centre, corners, edges
POSITIONAL_ORDER = (4, 0, 2, 6, 8, 1, 3, 5, 7)


def _first_available(moves, order=POSITIONAL_ORDER) -> int:
    for square in order:
        if square in moves:
            return square
    raise ValueError("no legal move available")


def _wins_immediately(state: GameState, move: int) -> bool:
    return winner(apply_move(state, move)) == state.to_move


def _blocks_immediately(state: GameState, move: int) -> bool:
    """Would the opponent win by taking this square right now?"""
    board = list(state.board)
    board[move] = -state.to_move
    return winner(GameState(tuple(board), state.to_move)) == -state.to_move


def _threat_count(state: GameState, move: int) -> int:
    after = apply_move(state, move)
    if is_terminal(after):
        return 0
    return sum(
        1
        for square, cell in enumerate(after.board)
        if cell == EMPTY and winner(apply_move(GameState(after.board, state.to_move), square)) == state.to_move
    )


def positional(state: GameState) -> int:
    """Policy C. Plays a fixed opening plan and never reacts to the opponent.

    Does not take an available win and does not block a loss. "Disengaged", not
    "nice" — the dilemma prices the cost of contesting, not virtue.
    """
    return _first_available(legal_moves(state))


def heuristic(state: GameState) -> int:
    """Policy D. Contests every threat: win, else block, else fork, else position."""
    moves = legal_moves(state)
    for move in moves:
        if _wins_immediately(state, move):
            return move
    for move in moves:
        if _blocks_immediately(state, move):
            return move
    forks = [move for move in moves if _threat_count(state, move) >= 2]
    if forks:
        return min(forks)
    return _first_available(moves)


POLICIES = {"C": positional, "D": heuristic}


def play_out(policy_x, policy_o) -> tuple[tuple[int, ...], int]:
    """Play one game. Returns (move sequence, +1 X seat wins / 0 draw / -1 O seat wins)."""
    state = GameState((EMPTY,) * 9, X)
    moves = []
    while not is_terminal(state):
        move = policy_x(state) if state.to_move == X else policy_o(state)
        moves.append(move)
        state = apply_move(state, move)
    victor = winner(state)
    return tuple(moves), 0 if victor is None else (1 if victor == X else -1)


def seat_symmetrised(policy_a, policy_b) -> float:
    """g(A, B) — A's board payoff against B, averaged over both seats.

    Tic-tac-toe is asymmetric because X moves first; the protocol alternates
    seats across six games and this mirrors that. Antisymmetric, with g(A,A) = 0,
    which is why the frozen bimatrix's R and P are set purely by the cost terms.
    """
    _, forward = play_out(policy_a, policy_b)
    _, reverse = play_out(policy_b, policy_a)
    return (forward - reverse) / 2


def derive_bimatrix(cost: float = 1 / 3, escalation: float = 1 / 3) -> dict[str, tuple[float, float]]:
    """Regenerate the frozen bimatrix from the policies themselves.

    payoff(i, j) = g(i, j) - cost*[i = D] - escalation*[i = D and j = D]

    quantum_arena.payoffs pins its constants against this, so the published
    matrix traces to a computation instead of to a note claiming it once did.
    """
    def entry(row: str, col: str) -> float:
        board = seat_symmetrised(POLICIES[row], POLICIES[col])
        return board - cost * (row == "D") - escalation * (row == "D" and col == "D")

    return {f"{x}{o}": (entry(x, o), entry(o, x)) for x in "CD" for o in "CD"}

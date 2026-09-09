import pytest

from ttt_lab.game import (
    GameState, O, X, apply_move, canonical_key, initial_state, is_terminal,
    legal_moves, reachable_states, symmetries, utility, validate_state, winner,
)


def play(*moves):
    state = initial_state()
    for move in moves:
        state = apply_move(state, move)
    return state


def test_initial_state_and_immutability():
    start = initial_state()
    child = apply_move(start, 4)
    assert start.board == (0,) * 9
    assert legal_moves(start) == tuple(range(9))
    assert child.board[4] == X and child.to_move == O


@pytest.mark.parametrize("moves", [
    (0, 3, 1, 4, 2), (3, 0, 4, 1, 5), (6, 0, 7, 1, 8),
    (0, 1, 3, 2, 6), (1, 0, 4, 2, 7), (2, 0, 5, 1, 8),
    (0, 1, 4, 2, 8), (2, 0, 4, 1, 6),
])
def test_every_winning_line_is_detected(moves):
    state = play(*moves)
    assert winner(state) == X
    assert is_terminal(state)
    assert legal_moves(state) == ()


def test_draw_and_utility():
    state = play(0, 1, 2, 4, 3, 5, 7, 6, 8)
    assert is_terminal(state) and winner(state) is None
    assert utility(state, X) == utility(state, O) == 0


@pytest.mark.parametrize("move", [-1, 9, True, 1.5, "4"])
def test_invalid_move_types_and_ranges_fail(move):
    with pytest.raises(ValueError):
        apply_move(initial_state(), move)


def test_occupied_and_post_terminal_moves_fail():
    with pytest.raises(ValueError, match="occupied"):
        apply_move(play(0), 0)
    with pytest.raises(ValueError, match="game is over"):
        apply_move(play(0, 3, 1, 4, 2), 8)


def test_nonterminal_utility_fails():
    with pytest.raises(ValueError):
        utility(initial_state(), X)


def test_every_enumerated_state_validates_and_successors_are_reachable():
    states = tuple(reachable_states())
    state_set = set(states)
    assert len(states) == len(state_set) == 5478
    for state in states:
        validate_state(state)
        for move in legal_moves(state):
            assert apply_move(state, move) in state_set


@pytest.mark.parametrize("bad", [
    GameState((0,) * 8, X),
    GameState((2,) + (0,) * 8, X),
    GameState((X,) + (0,) * 8, X),
    GameState((X, X, X, O, O, O, 0, 0, 0), X),
    GameState((X, X, X, O, O, 0, O, O, X), X),
])
def test_unreachable_states_fail_validation(bad):
    with pytest.raises(ValueError):
        validate_state(bad)


def test_symmetries_share_a_canonical_key_and_preserve_outcome():
    state = play(0, 3, 1, 4, 2)
    keys = set()
    for board in symmetries(state.board):
        transformed = GameState(board, state.to_move)
        keys.add(canonical_key(transformed))
        assert winner(transformed) == X
        assert is_terminal(transformed)
    assert len(keys) == 1

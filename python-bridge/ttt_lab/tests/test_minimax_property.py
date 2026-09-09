from collections import Counter

from ttt_lab.game import apply_move, initial_state, is_terminal, reachable_states
from ttt_lab.policies.minimax import action_values, analyze_choice, choose_move, state_value


def play(*moves):
    state = initial_state()
    for move in moves:
        state = apply_move(state, move)
    return state


def test_initial_position_is_a_forced_draw():
    assert state_value(initial_state()) == 0


def test_perfect_self_play_draws():
    state = initial_state()
    while not is_terminal(state):
        state = apply_move(state, choose_move(state))
    assert state_value(state) == 0


def test_takes_immediate_win_and_blocks_forced_loss():
    assert choose_move(play(0, 3, 1, 4)) == 2
    assert choose_move(play(0, 3, 8, 4)) == 5


def test_bellman_recurrence_and_legal_choice_exhaustively():
    saw_forced_win = saw_forced_loss = False
    for state in reachable_states():
        if is_terminal(state):
            continue
        values = action_values(state)
        assert set(values) == set(index for index, cell in enumerate(state.board) if cell == 0)
        assert state_value(state) == max(values.values())
        assert values[choose_move(state)] == state_value(state)
        saw_forced_win |= state_value(state) == 1
        saw_forced_loss |= state_value(state) == -1
    assert saw_forced_win and saw_forced_loss


def test_exact_reachable_state_value_counts():
    counts = Counter(state_value(state) for state in reachable_states() if not is_terminal(state))
    assert counts == {-1: 632, 0: 1052, 1: 2836}


def test_exact_choice_taxonomy_census():
    counts = Counter()
    for state in reachable_states():
        if is_terminal(state):
            continue
        for move in action_values(state):
            counts[analyze_choice(state, move).error_type] += 1
    assert counts == {
        None: 8863,
        "missed-win-to-loss": 3816,
        "surrendered-draw": 2104,
        "missed-win-to-draw": 1384,
    }


def test_terminal_state_has_no_decision():
    state = play(0, 3, 1, 4, 2)
    try:
        choose_move(state)
    except ValueError as error:
        assert "no actions" in str(error)
    else:
        raise AssertionError("terminal state unexpectedly returned a move")

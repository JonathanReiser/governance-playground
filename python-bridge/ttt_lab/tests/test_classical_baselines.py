import pytest

from ttt_lab.game import GameState, X, apply_move, initial_state, is_terminal
from ttt_lab.policies.depth_aware import action_scores, probabilities as depth_probabilities
from ttt_lab.policies.features import move_features, probabilities as feature_probabilities
from ttt_lab.policies.minimax import action_values


def test_discounted_scores_preserve_minimax_outcome_classes():
    # Every positive/draw/negative discounted score has the same outcome sign.
    stack = [initial_state()]
    seen = set()
    while stack:
        state = stack.pop()
        if state in seen:
            continue
        seen.add(state)
        if not is_terminal(state):
            exact = action_values(state)
            discounted = action_scores(state, 0.9)
            assert {move: (score > 0) - (score < 0) for move, score in discounted.items()} == exact
            stack.extend(apply_move(state, move) for move in exact)


def test_depth_temperature_limits():
    state = GameState((X, X, 0, -X, -X, 0, 0, 0, 0), X)
    cold = depth_probabilities(state, 0)
    assert cold.probabilities[cold.moves.index(2)] == 1
    hot = depth_probabilities(state, float("inf"))
    assert len(set(hot.probabilities)) == 1


def test_feature_policy_recognizes_win_block_and_geometry():
    winning = GameState((X, X, 0, -X, 0, 0, -X, 0, 0), X)
    assert move_features(winning, 2)["immediate_win"] == 1
    blocking = GameState((-X, -X, 0, X, 0, 0, X, 0, 0), X)
    assert move_features(blocking, 2)["immediate_block"] == 1
    opening = move_features(initial_state(), 4)
    assert opening["center"] == 1 and opening["corner"] == 0


def test_feature_probabilities_are_normalized_and_favor_immediate_win():
    state = GameState((X, X, 0, -X, -X, 0, 0, 0, 0), X)
    decision = feature_probabilities(state)
    assert sum(decision.probabilities) == pytest.approx(1)
    assert decision.moves[decision.probabilities.index(max(decision.probabilities))] == 2

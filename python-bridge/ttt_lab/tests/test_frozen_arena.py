"""The frozen policies, and the bimatrix they must reproduce."""

import pytest

from ttt_lab.game import initial_state, is_terminal, legal_moves, reachable_states
from ttt_lab.policies.frozen_arena import (
    POLICIES, derive_bimatrix, heuristic, play_out, positional, seat_symmetrised,
)
from quantum_arena.payoffs import BIMATRIX


class TestPoliciesAreTotalAndDeterministic:
    @pytest.mark.parametrize("policy", [positional, heuristic])
    def test_returns_a_legal_move_from_every_reachable_position(self, policy):
        for state in reachable_states():
            if is_terminal(state):
                continue
            assert policy(state) in legal_moves(state)

    @pytest.mark.parametrize("policy", [positional, heuristic])
    def test_is_deterministic(self, policy):
        for state in list(reachable_states())[:400]:
            if is_terminal(state):
                continue
            assert policy(state) == policy(state)


def _position(*moves):
    from ttt_lab.game import apply_move
    state = initial_state()
    for move in moves:
        state = apply_move(state, move)
    return state


class TestTheyDifferOnlyInEngagement:
    """The single behavioural difference the cost term is meant to price."""

    def test_heuristic_blocks_an_immediate_loss_that_positional_walks_into(self):
        # X:0,8  O:1,4 — O threatens the 1-4-7 column, so 7 must be taken.
        state = _position(0, 1, 8, 4)
        assert heuristic(state) == 7, "engagement means blocking the immediate threat"
        assert positional(state) != 7, "disengagement means not reacting to it"

    def test_heuristic_takes_an_available_win_and_positional_declines_it(self):
        from ttt_lab.game import winner, apply_move
        # X:4,0,8 gives X the 0-4-8 diagonal; find a live position where it is open.
        state = _position(4, 1, 0, 3)  # X:4,0  O:1,3 — X wins by taking 8
        assert winner(apply_move(state, 8)) == state.to_move, "8 is genuinely a winning square"
        assert heuristic(state) == 8
        assert positional(state) != 8

    def test_they_agree_whenever_nothing_is_at_stake(self):
        """On an empty board neither has a threat to react to, so engagement
        cannot show. If they diverged here the difference would be positional
        taste rather than engagement, and the cost term would price the wrong
        thing."""
        assert heuristic(initial_state()) == positional(initial_state())


class TestSeatSymmetrisation:
    def test_is_antisymmetric_with_zero_diagonal(self):
        for a in POLICIES.values():
            assert seat_symmetrised(a, a) == 0.0
        forward = seat_symmetrised(POLICIES["D"], POLICIES["C"])
        assert seat_symmetrised(POLICIES["C"], POLICIES["D"]) == -forward

    def test_engagement_beats_disengagement_by_a_full_point(self):
        assert seat_symmetrised(POLICIES["D"], POLICIES["C"]) == 1.0

    def test_play_out_returns_a_complete_game(self):
        moves, result = play_out(POLICIES["C"], POLICIES["C"])
        assert len(moves) == len(set(moves))
        assert result in (-1, 0, 1)


class TestDerivedBimatrixMatchesTheFrozenConstants:
    def test_regenerating_from_the_policies_reproduces_payoffs_py(self):
        """The published matrix must trace to a computation, not to a note saying it did.

        If someone retunes a policy, or the costs, this fails rather than leaving
        quantum_arena/payoffs.py quietly describing a game nobody plays any more.
        """
        derived = derive_bimatrix()
        assert set(derived) == set(BIMATRIX)
        for profile, (x, o) in BIMATRIX.items():
            assert derived[profile][0] == pytest.approx(x, abs=1e-12)
            assert derived[profile][1] == pytest.approx(o, abs=1e-12)

    def test_the_costs_are_what_the_spec_froze(self):
        assert derive_bimatrix(cost=1 / 3, escalation=1 / 3) == derive_bimatrix()

    def test_dropping_the_escalation_term_changes_the_matrix(self):
        """c alone forces T-R == P-S and cannot reach the canonical PD."""
        assert derive_bimatrix(escalation=0.0) != derive_bimatrix()

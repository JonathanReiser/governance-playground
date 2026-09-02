"""
Tests for ewl_game.py.

TestRegressionTable is the one that matters most, and it is written the
way it is on purpose. Every assertion is an EXACT expected value derived
independently from the EWL literature, not a range check on a quantity
the code also produced. The failure mode being avoided is the sibling
repo quantum-orch-or's tests/test_quantum_economics.py:19, which asserts
`order_effect_delta >= 0.0` on a value that is already an abs() — a test
that cannot fail, guarding an effect that is in fact exactly 0.0. Nothing
here is satisfiable by a broken implementation returning zeros: several
assertions are strict inequalities in a specific direction, and
TestBenjaminHayden asserts a value the module's own headline result must
LOSE to.
"""

import math

import pytest

from ewl_game import (
    CANONICAL_PD,
    MAX_ENTANGLEMENT,
    RESTRICTED_STRATEGIES,
    U_C,
    U_COUNTER_Q,
    U_D,
    U_Q,
    PayoffMatrix,
    best_response_over_su2,
    classical_nash,
    correlated_equilibrium,
    entangling_operator,
    entanglement_threshold,
    ewl_equilibria,
    ewl_payoffs,
    is_correlated_equilibrium,
    is_prisoners_dilemma,
    restricted_game,
)

# Two named 2x2 games that are NOT prisoner's dilemmas, used to prove the
# equilibrium code re-derives rather than pattern-matches the PD.
DEADLOCK = PayoffMatrix(cc=(1.0, 1.0), cd=(0.0, 5.0), dc=(5.0, 0.0), dd=(3.0, 3.0))
CHICKEN = PayoffMatrix(cc=(3.0, 3.0), cd=(2.0, 4.0), dc=(4.0, 2.0), dd=(0.0, 0.0))


def payoff(s1: str, s2: str, payoffs=CANONICAL_PD, gamma: float = MAX_ENTANGLEMENT):
    return ewl_payoffs(RESTRICTED_STRATEGIES[s1], RESTRICTED_STRATEGIES[s2], payoffs, gamma)[0]


class TestRegressionTable:
    """
    The full 3x3 table of EWL payoffs under the canonical PD at maximal
    entanglement. Exact values, asserted to 1e-9.
    """

    # (player 1 strategy, player 2 strategy, expected payoff pair)
    EXPECTED = [
        ("C", "C", (3.0, 3.0)),  # classical mutual cooperation
        ("D", "D", (1.0, 1.0)),  # the classical Nash trap — the dilemma
        ("C", "D", (0.0, 5.0)),
        ("D", "C", (5.0, 0.0)),
        ("Q", "D", (5.0, 0.0)),  # the quantum strategy beats a classical defector
        ("D", "Q", (0.0, 5.0)),
        ("Q", "C", (1.0, 1.0)),
        ("C", "Q", (1.0, 1.0)),
        ("Q", "Q", (3.0, 3.0)),  # Pareto-optimal quantum equilibrium
    ]

    @pytest.mark.parametrize("s1,s2,expected", EXPECTED)
    def test_exact_payoffs(self, s1, s2, expected):
        result = payoff(s1, s2)
        assert result == pytest.approx(expected, abs=1e-9)

    def test_probabilities_are_a_normalised_distribution(self):
        for s1 in RESTRICTED_STRATEGIES:
            for s2 in RESTRICTED_STRATEGIES:
                _, probs = ewl_payoffs(RESTRICTED_STRATEGIES[s1], RESTRICTED_STRATEGIES[s2])
                assert sum(probs.values()) == pytest.approx(1.0, abs=1e-9)
                assert all(value >= -1e-12 for value in probs.values())


class TestBitOrdering:
    """
    Player 1 is qubit 0, player 2 is qubit 1, and Qiskit indexes as
    2*q1 + q0 — so index 1 is DC, not CD. Transposing that would swap
    (0,5) and (5,0) silently, without raising anything. These assertions
    are on the ASYMMETRIC profiles specifically, since the symmetric ones
    would pass either way.
    """

    def test_defector_against_cooperator_gets_the_temptation_payoff(self):
        p1, p2 = payoff("D", "C")
        assert p1 == pytest.approx(5.0) and p2 == pytest.approx(0.0)

    def test_cooperator_against_defector_gets_the_suckers_payoff(self):
        p1, p2 = payoff("C", "D")
        assert p1 == pytest.approx(0.0) and p2 == pytest.approx(5.0)

    def test_profile_probability_labels_match_the_payoffs_they_produce(self):
        _, probs = ewl_payoffs(U_D, U_C)
        assert probs["DC"] == pytest.approx(1.0)
        assert probs["CD"] == pytest.approx(0.0)


class TestEntanglingOperator:
    def test_maximal_gamma_matches_the_closed_form_from_the_literature(self):
        import numpy as np

        x_x = np.kron(np.array([[0, 1], [1, 0]]), np.array([[0, 1], [1, 0]]))
        expected = (1 / math.sqrt(2)) * (np.eye(4) + 1j * x_x)
        assert np.allclose(entangling_operator(MAX_ENTANGLEMENT), expected)

    def test_operator_is_unitary_across_the_whole_gamma_range(self):
        import numpy as np

        for gamma in np.linspace(0.0, MAX_ENTANGLEMENT, 9):
            j_matrix = entangling_operator(float(gamma))
            assert np.allclose(j_matrix @ j_matrix.conj().T, np.eye(4))

    def test_zero_entanglement_reproduces_the_classical_game_exactly(self):
        # The strongest structural check available: with gamma=0 the EWL
        # circuit must collapse to the ordinary PD for the classical
        # strategies. If the circuit or the ordering were wrong, this is
        # where it shows up without reference to any quantum result.
        for s1 in "CD":
            for s2 in "CD":
                expected = CANONICAL_PD.as_dict()[s1 + s2]
                assert payoff(s1, s2, gamma=0.0) == pytest.approx(expected, abs=1e-9)

    def test_quantum_strategy_has_no_advantage_without_entanglement(self):
        # Q beats D by 5.0 to 1.0 at maximal entanglement; with no
        # entanglement it must do strictly WORSE than defecting, since Q
        # is then just a phase on a product state.
        assert payoff("Q", "D", gamma=0.0)[0] < payoff("D", "D", gamma=0.0)[0]


class TestClassicalNash:
    def test_prisoners_dilemma_has_mutual_defection_as_its_only_equilibrium(self):
        nash = classical_nash(CANONICAL_PD)
        assert [entry["profile"] for entry in nash["pure"]] == ["DD"]
        assert nash["pure"][0]["payoffs"] == (1.0, 1.0)

    def test_prisoners_dilemma_has_no_interior_mixed_equilibrium(self):
        # The indifference solution is out of [0,1] here; it must be
        # reported as absent rather than clipped into range.
        assert classical_nash(CANONICAL_PD)["mixed"] is None

    def test_chicken_has_two_pure_equilibria_and_a_mixed_one(self):
        nash = classical_nash(CHICKEN)
        assert sorted(entry["profile"] for entry in nash["pure"]) == ["CD", "DC"]
        assert nash["mixed"]["p1_prob_cooperate"] == pytest.approx(2 / 3)
        assert nash["mixed"]["expected_payoffs"] == pytest.approx((8 / 3, 8 / 3))


class TestCorrelatedEquilibrium:
    def test_prisoners_dilemma_correlated_set_collapses_onto_nash(self):
        # The result that actually matters for the writeup: a correlating
        # device buys NOTHING in a strict PD, because a strictly dominated
        # action gets zero weight in every correlated equilibrium. Any
        # claim that entanglement helps has to be measured against this,
        # not against Nash.
        correlated = correlated_equilibrium(CANONICAL_PD)
        assert correlated["is_singleton"] is True
        assert correlated["unique_profile"] == "DD"
        assert correlated["expected_payoffs"] == pytest.approx((1.0, 1.0))
        assert correlated["welfare_range"] == pytest.approx((2.0, 2.0))
        assert correlated["probability_ranges"]["CC"] == pytest.approx((0.0, 0.0))

    def test_chicken_correlated_set_is_strictly_larger_than_its_nash_set(self):
        # The contrast case — proves the PD result above is a property of
        # the PD and not the LP always returning a single point.
        correlated = correlated_equilibrium(CHICKEN)
        assert correlated["is_singleton"] is False
        low, high = correlated["welfare_range"]
        assert low < high
        # Mutual cooperation gets positive weight in some correlated
        # equilibrium, which no Nash equilibrium of chicken does.
        assert correlated["probability_ranges"]["CC"][1] > 0.0

    def test_hand_computed_chicken_distribution_verified_independently(self):
        # 1/3 on each of CC, CD, DC — checked by hand against Aumann's
        # constraints, then checked here by a routine that does not use
        # the LP, and finally checked to lie inside the LP's own ranges.
        # Three independent routes to the same answer.
        distribution = {"CC": 1 / 3, "CD": 1 / 3, "DC": 1 / 3, "DD": 0.0}
        assert is_correlated_equilibrium(distribution, CHICKEN) is True
        ranges = correlated_equilibrium(CHICKEN)["probability_ranges"]
        for profile, probability in distribution.items():
            low, high = ranges[profile]
            assert low - 1e-9 <= probability <= high + 1e-9

    def test_rejects_a_distribution_that_is_not_a_correlated_equilibrium(self):
        # Mutual cooperation in a PD is the obvious non-CE: both players
        # would deviate. If this passed, the checker would be vacuous.
        assert is_correlated_equilibrium({"CC": 1.0}, CANONICAL_PD) is False

    def test_rejects_a_distribution_that_is_not_a_distribution(self):
        assert is_correlated_equilibrium({"DD": 0.5}, CANONICAL_PD) is False
        assert is_correlated_equilibrium({"DD": 1.5, "CC": -0.5}, CANONICAL_PD) is False


class TestEwlEquilibria:
    def test_quantum_equilibrium_is_mutual_Q_at_the_pareto_optimum(self):
        equilibria = ewl_equilibria(CANONICAL_PD)["equilibria"]
        assert [entry["profile"] for entry in equilibria] == ["QQ"]
        assert equilibria[0]["payoffs"] == pytest.approx((3.0, 3.0))

    def test_mutual_defection_stops_being_an_equilibrium_once_Q_is_available(self):
        # The dilemma's Nash point is destroyed inside the restricted
        # quantum game: Q scores 5.0 against D, so D is no longer a best
        # response to D. Asserting the ABSENCE of DD, not just presence of
        # QQ — a stub returning every profile would pass the test above.
        assert "DD" not in [entry["profile"] for entry in ewl_equilibria(CANONICAL_PD)["equilibria"]]
        assert restricted_game(CANONICAL_PD)[("Q", "D")][0] == pytest.approx(5.0)

    def test_no_quantum_equilibrium_exists_for_a_deadlock_game(self):
        # The "re-derive, don't assume" caveat, made falsifiable. Deadlock
        # is not a PD (mutual defection beats mutual cooperation), and it
        # has NO pure equilibrium in the restricted quantum game at all —
        # so (Q,Q) is emphatically not automatic under other payoffs.
        assert is_prisoners_dilemma(DEADLOCK)["is_prisoners_dilemma"] is False
        assert ewl_equilibria(DEADLOCK)["equilibria"] == []

    def test_result_is_always_labelled_as_restricted(self):
        assert "RESTRICTED" in ewl_equilibria(CANONICAL_PD)["caveat"]


class TestEntanglementThreshold:
    def test_canonical_pd_threshold_is_arcsin_sqrt_two_fifths(self):
        # The binding deviation is D against Q, whose payoff falls as
        # 5*cos^2(gamma) and crosses Q's flat 3.0 at sin^2(gamma) = 2/5.
        result = entanglement_threshold(CANONICAL_PD)
        assert result["holds_at_maximal"] is True
        assert result["threshold"] == pytest.approx(math.asin(math.sqrt(0.4)), abs=1e-6)
        assert result["monotone"] is True

    def test_threshold_is_a_real_boundary_not_a_reported_number(self):
        # Just below it, (Q,Q) must actually fail to be an equilibrium;
        # just above, it must hold. Without this the threshold could be
        # any number at all and the test above would still pass.
        threshold = entanglement_threshold(CANONICAL_PD)["threshold"]
        from ewl_game import pure_nash

        assert ("Q", "Q") not in pure_nash(restricted_game(CANONICAL_PD, threshold - 0.01))
        assert ("Q", "Q") in pure_nash(restricted_game(CANONICAL_PD, threshold + 0.01))

    def test_maximal_entanglement_is_not_required(self):
        # A caveat worth stating precisely rather than as "needs maximal
        # entanglement": the threshold sits well below pi/2.
        assert entanglement_threshold(CANONICAL_PD)["threshold"] < MAX_ENTANGLEMENT

    def test_no_threshold_when_the_profile_never_holds(self):
        assert entanglement_threshold(DEADLOCK)["threshold"] is None
        assert entanglement_threshold(DEADLOCK)["holds_at_maximal"] is False


class TestBenjaminHayden:
    """
    Benjamin & Hayden, Phys. Rev. Lett. 87, 069801 (2001) — (Q,Q) is an
    artifact of an arbitrarily restricted strategy space. Reproduced, not
    just cited. These assertions are deliberately hostile to this module's
    own headline result.
    """

    def test_a_closed_form_su2_strategy_outside_the_restricted_set_beats_Q(self):
        # [[0,1],[-1,0]] is a legitimate SU(2) unitary that EWL's set
        # excludes. Against Q it scores 5.0, versus Q's own 3.0 — so
        # (Q,Q) is not an equilibrium of the unrestricted game.
        (p1, p2), _ = ewl_payoffs(U_COUNTER_Q, U_Q)
        assert p1 == pytest.approx(5.0, abs=1e-9)
        assert p2 == pytest.approx(0.0, abs=1e-9)
        assert p1 > ewl_payoffs(U_Q, U_Q)[0][0]

    def test_the_counter_strategy_is_genuinely_unitary(self):
        # Otherwise the objection above would be a bug, not a refutation.
        import numpy as np

        assert np.allclose(U_COUNTER_Q @ U_COUNTER_Q.conj().T, np.eye(2))
        assert np.linalg.det(U_COUNTER_Q) == pytest.approx(1.0)

    def test_numerical_search_over_su2_confirms_the_restricted_set_is_not_closed(self):
        result = best_response_over_su2(U_Q, restarts=40)
        assert result["best_payoff_within_restricted_set"] == pytest.approx(3.0, abs=1e-6)
        assert result["best_payoff_over_su2"] == pytest.approx(5.0, abs=1e-4)
        assert result["restricted_set_is_closed"] is False


class TestIsPrisonersDilemma:
    def test_canonical_payoffs_are_a_prisoners_dilemma(self):
        check = is_prisoners_dilemma(CANONICAL_PD)
        assert check["is_prisoners_dilemma"] is True
        assert check["T_R_P_S"] == (5.0, 3.0, 1.0, 0.0)

    def test_deadlock_and_chicken_are_rejected(self):
        assert is_prisoners_dilemma(DEADLOCK)["ordering_T_gt_R_gt_P_gt_S"] is False
        assert is_prisoners_dilemma(CHICKEN)["ordering_T_gt_R_gt_P_gt_S"] is False

    def test_asymmetric_matrix_is_rejected_as_not_symmetric(self):
        lopsided = PayoffMatrix(cc=(3.0, 2.0), cd=(0.0, 5.0), dc=(5.0, 0.0), dd=(1.0, 1.0))
        assert is_prisoners_dilemma(lopsided)["symmetric"] is False
        assert is_prisoners_dilemma(lopsided)["is_prisoners_dilemma"] is False

    def test_alternating_exploitation_condition_is_actually_checked(self):
        # T > R > P > S holds here but 2R < T + S, so it is not a PD —
        # the condition would be dead code if nothing exercised it.
        greedy = PayoffMatrix(cc=(3.0, 3.0), cd=(0.0, 9.0), dc=(9.0, 0.0), dd=(1.0, 1.0))
        assert is_prisoners_dilemma(greedy)["ordering_T_gt_R_gt_P_gt_S"] is True
        assert is_prisoners_dilemma(greedy)["mutual_cooperation_beats_alternating"] is False
        assert is_prisoners_dilemma(greedy)["is_prisoners_dilemma"] is False

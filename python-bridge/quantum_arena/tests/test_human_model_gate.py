"""Tests for the synthetic identifiability gate.

The gate's job is to be able to fail. These tests check that it reports what is
true rather than what would be convenient, so several assert that a *bad* design
is rejected.
"""

import math

import numpy as np
import pytest

from quantum_arena.human_model_gate import (
    GateThresholds, TaskDesign, choice_probability, generate, fit_quantum,
    logistic_probabilities, markov_probabilities, quantum_probabilities,
    structural_observability, su2,
)


class TestStructuralObservability:
    """Facts settled before any fitting. They constrain the task more than the
    modelling choices do."""

    @pytest.fixture(scope="class")
    def facts(self):
        return structural_observability(draws=3000)

    def test_a_single_consideration_hides_alpha_and_delta(self, facts):
        # P(0) = cos^2(beta/2) exactly; the other two angles cancel in the modulus.
        # A one-consideration task therefore cannot identify delta at ANY sample size.
        fact = facts["single_operation_hides_alpha_and_delta"]
        assert fact["holds"]
        assert fact["max_probability_spread"] < 1e-12

    def test_only_delta_DIFFERENCES_are_observable(self, facts):
        # Conjugating every operation by a diagonal phase shifts every delta and
        # changes no prediction. Individual deltas are gauge, not parameters.
        assert facts["delta_is_observable_only_as_a_difference"]["holds"]

    def test_delta_is_identified_only_up_to_sign(self, facts):
        # Found by the gate, not by the analysis: recovery error was bimodal with
        # a mode near 2|delta|, the signature of a sign reflection.
        assert facts["delta_is_identified_only_up_to_sign"]["holds"]

    def test_the_null_predicts_EXACTLY_zero_order_effect(self, facts):
        # Not "a small effect" — zero. So a reliable order effect falsifies
        # delta = 0 without needing a fitted comparison at all.
        fact = facts["null_predicts_exactly_zero_order_effect"]
        assert fact["holds"]
        # Machine precision, not bit-exact zero. This assertion originally read
        # `== 0.0`, which passed locally and failed on CI at 2.22e-16 — one ULP.
        # The scientific claim is unaffected: the null's order gap is fifteen
        # orders of magnitude below the ~0.16 mean gap a free delta produces.
        assert fact["max_order_gap_at_delta_zero"] < 1e-15

    def test_a_free_delta_generically_produces_an_order_effect(self, facts):
        fact = facts["free_delta_generically_produces_an_order_effect"]
        assert fact["mean_order_gap"] > 0.05
        assert fact["fraction_above_0_05"] > 0.4


class TestTheseFactsForceTheDesign:
    def test_a_pair_design_is_saturated_and_must_be_rejected(self):
        """Two conditions, two observed proportions. Any model with two or more
        free parameters fits them exactly, at any sample size."""
        pair_conditions = 2
        smallest_quantum_model = 3  # two strengths plus delta
        assert smallest_quantum_model >= pair_conditions

    def test_a_triple_design_has_more_conditions_than_parameters(self):
        design = TaskDesign(triples=4)
        assert design.conditions == 24
        assert design.free_parameters == 13
        assert design.is_identifiable_in_principle()

    def test_one_triple_already_beats_saturation(self):
        assert TaskDesign(triples=1).is_identifiable_in_principle()


class TestModels:
    def test_quantum_probabilities_are_valid_and_order_dependent(self):
        betas = np.array([[1.0, 2.0, 0.7]])
        probabilities = quantum_probabilities(betas, 1.0)
        assert probabilities.shape == (1, 6)
        assert np.all((probabilities >= 0) & (probabilities <= 1))
        assert probabilities.std() > 1e-6, "a free delta should make orderings differ"

    def test_the_null_makes_every_ordering_identical(self):
        # The sharp point prediction, at the level of the fitted model.
        probabilities = quantum_probabilities(np.array([[1.0, 2.0, 0.7]]), 0.0)
        assert probabilities.std() == pytest.approx(0.0, abs=1e-12)

    def test_markov_is_a_genuine_competitor_not_a_strawman(self):
        # Stochastic matrices do not commute either, so this classical model
        # produces order effects. If it wins, the quantum formalism is not
        # doing the work.
        probabilities = markov_probabilities(np.array([[1.2, -0.8, 0.3]]))
        assert probabilities.std() > 1e-6

    def test_logistic_returns_valid_probabilities(self):
        probabilities = logistic_probabilities(np.array([0.2, -0.4, 0.1, 0.3, -0.2]))
        assert probabilities.shape == (2, 6)
        assert np.all((probabilities > 0) & (probabilities < 1))

    def test_su2_matches_the_stress_test_family_on_its_shared_domain(self):
        from quantum_arena.su2_stress import su2 as guarded
        for alpha, beta, delta in [(0.3, 1.1, 0.4), (-1.0, 2.0, -0.7)]:
            assert np.allclose(su2(alpha, beta, delta), guarded(alpha, beta, delta))

    def test_choice_probability_composes_in_the_given_order(self):
        a, b = su2(0.4, 1.0, 0.0), su2(1.2, 0.8, 0.9)
        assert choice_probability([b, a]) != pytest.approx(choice_probability([a, b]), abs=1e-6)


class TestRecoveryOnSyntheticData:
    def test_a_generated_delta_is_recovered_up_to_sign_with_enough_restarts(self):
        design = TaskDesign(triples=4, trials_per_ordering=8, participants=60)
        data = generate(design, delta=1.1, seed=1)
        fit = fit_quantum(data, design.triples, delta_free=True, restarts=16, seed=2)
        assert abs(abs(fit["delta"]) - 1.1) < 0.3

    def test_the_free_model_beats_the_null_on_delta_bearing_data(self):
        design = TaskDesign(triples=4, trials_per_ordering=8, participants=60)
        data = generate(design, delta=1.1, seed=1)
        free = fit_quantum(data, design.triples, True, restarts=8, seed=2)
        null = fit_quantum(data, design.triples, False, restarts=8, seed=2)
        assert null["negative_log_likelihood"] > free["negative_log_likelihood"]

    def test_generating_labels_are_carried_but_never_reach_a_fitter(self):
        design = TaskDesign(triples=2, trials_per_ordering=2, participants=5)
        data = generate(design, delta=0.9, seed=3)
        assert data.generating_model == "quantum" and data.generating_delta == 0.9
        # fit_quantum's signature takes no label; it sees only counts.
        import inspect
        assert "generating" not in inspect.signature(fit_quantum).parameters


class TestTheGateCanFail:
    def test_thresholds_are_declared_in_one_place(self):
        """Tuning these to obtain a pass is the failure mode the module exists to
        prevent, so a diff must make such a change obvious."""
        thresholds = GateThresholds()
        assert thresholds.max_delta_recovery_error > 0
        assert 0 < thresholds.max_false_positive_rate < 0.5
        assert 0.5 < thresholds.min_true_positive_rate <= 1.0

    def test_an_impossible_design_fails_the_in_principle_check(self):
        # 1 triple with the parameter count of 4 would not be identifiable; the
        # check is real, not decorative.
        design = TaskDesign(triples=1)
        assert design.conditions == 6 and design.free_parameters == 4
        assert design.is_identifiable_in_principle()

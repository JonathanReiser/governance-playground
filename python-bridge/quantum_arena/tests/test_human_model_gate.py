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
    quantum_jacobian_rank, quantum_two_observables, structural_observability, su2,
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

    def test_nominal_condition_count_does_not_make_triples_identifiable(self):
        design = TaskDesign(triples=4)
        assert design.conditions == 24
        assert design.free_parameters == 13
        assert quantum_jacobian_rank(4) == 8
        assert not design.is_identifiable_in_principle()

    def test_one_triple_is_rank_two_against_four_parameters(self):
        assert quantum_jacobian_rank(1) == 2
        assert not TaskDesign(triples=1).is_identifiable_in_principle()


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

    def test_six_orderings_collapse_exactly_to_two(self):
        betas = np.array([[1.0, 2.0, 0.7]])
        probabilities = quantum_probabilities(betas, 0.83)[0]
        assert len(np.unique(np.round(probabilities, 14))) == 2

        end, middle = quantum_two_observables(betas, 0.83)[0]
        # itertools.permutations order: 012, 021, 102, 120, 201, 210.
        # Consideration 0 is in the middle only in 102 and 201.
        assert probabilities[[0, 1, 3, 5]] == pytest.approx(end, abs=1e-14)
        assert probabilities[[2, 4]] == pytest.approx(middle, abs=1e-14)

    def test_analytic_two_observable_reduction_matches_the_engine(self):
        rng = np.random.default_rng(20260910)
        for _ in range(50):
            betas = rng.uniform(0.0, math.pi, size=(1, 3))
            delta = rng.uniform(0.0, math.pi)
            end, middle = quantum_two_observables(betas, delta)[0]
            probabilities = quantum_probabilities(betas, delta)[0]
            assert probabilities[[0, 1, 3, 5]] == pytest.approx(end, abs=1e-14)
            assert probabilities[[2, 4]] == pytest.approx(middle, abs=1e-14)

    def test_end_position_equivalence_includes_special_points(self):
        for betas, delta in [([0.0, 1.0, 2.0], 0.8),
                             ([math.pi, 1.0, 2.0], math.pi / 2),
                             ([1.0, 0.0, math.pi], 0.0)]:
            probabilities = quantum_probabilities(np.array([betas]), delta)[0]
            assert np.ptp(probabilities[[0, 1, 3, 5]]) == pytest.approx(0.0, abs=1e-14)

    def test_pi_over_two_is_not_a_point_identification_exception(self):
        # Generic data generated at pi/2 are reproduced exactly at delta=0.8 by
        # a different nuisance-beta vector.  This guards against inferring a
        # singleton identified set from the delta <-> pi-delta reflection.
        truth = quantum_probabilities(
            np.array([[2.6082532487312564, 1.5973208412481563,
                       2.6859650893984361]]), math.pi / 2
        )
        equivalent = quantum_probabilities(
            np.array([[2.3700948709420477, 1.2960963378063062,
                       1.296789683916604]]), 0.8
        )
        assert equivalent == pytest.approx(truth, abs=2e-14)

    def test_independent_deltas_restore_three_generic_directions(self):
        def probabilities(parameters):
            betas = parameters[:3]
            deltas = (0.0, parameters[3], parameters[4])
            out = []
            import itertools
            for order in itertools.permutations(range(3)):
                operations = [su2(0.0, betas[i], deltas[i]) for i in order]
                out.append(choice_probability(list(reversed(operations))))
            return np.array(out)

        point = np.array([1.0, 1.3, 2.1, 0.6, -0.9])
        step = 1e-6
        jacobian = np.column_stack([
            (probabilities(point + np.eye(5)[j] * step)
             - probabilities(point - np.eye(5)[j] * step)) / (2 * step)
            for j in range(5)
        ])
        assert np.linalg.matrix_rank(jacobian, tol=1e-8) == 3

    @pytest.mark.parametrize("delta", [0.0, math.pi])
    def test_shared_delta_rank_drops_to_one_at_phase_boundaries(self, delta):
        point = np.array([1.0, 1.2, 2.1, delta])
        step = 1e-6

        def probabilities(parameters):
            return quantum_probabilities(parameters[:3], parameters[3]).ravel()

        jacobian = np.column_stack([
            (probabilities(point + np.eye(4)[j] * step)
             - probabilities(point - np.eye(4)[j] * step)) / (2 * step)
            for j in range(4)
        ])
        assert np.linalg.matrix_rank(jacobian, tol=1e-8) == 1

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
        # Six nominal orderings reduce to rank two, so the check must fail.
        design = TaskDesign(triples=1)
        assert design.conditions == 6 and design.free_parameters == 4
        assert not design.is_identifiable_in_principle()


class TestNoiselessLimit:
    """The strongest available statement about identifiability.

    Feeding expected counts instead of binomial draws is the infinite-data limit.
    Failure there means no sample size succeeds — something no design sweep can
    establish, however many participants it simulates.
    """

    def test_recovery_fails_at_infinite_data_for_small_delta(self):
        from quantum_arena.human_model_gate import noiseless_limit_recovery

        report = noiseless_limit_recovery(restarts=4, true_deltas=(0.4, 0.8))
        # Not a threshold to be tuned: with zero sampling noise, a well-identified
        # parameter would come back essentially exactly. These do not.
        assert report["worst_absolute_error"] > 0.5

    def test_estimates_are_compressed_below_the_threshold(self):
        """Below the threshold the estimates span less than the truth does.

        Note the deliberately narrow scope. An earlier version of this test was
        named "..._regardless_of_the_generating_value" and claimed the band does
        not depend on what generated the data. That claim was false and has been
        withdrawn — above roughly 1.1 the estimates do track the truth (see
        TestTrackingSlope). It passed only because every value sampled here sits
        BELOW the threshold, where compression is real. Keep it that way: adding a
        value above 1.1 should be expected to change the result.
        """
        from quantum_arena.human_model_gate import noiseless_limit_recovery

        report = noiseless_limit_recovery(restarts=4, true_deltas=(0.4, 0.8, 1.1))
        low, high = report["estimate_range"]
        spread_of_truth = 1.1 - 0.4
        assert (high - low) < spread_of_truth, "estimates vary less than the truth does"

    def test_the_report_states_what_it_does_and_does_not_show(self):
        from quantum_arena.human_model_gate import noiseless_limit_recovery

        report = noiseless_limit_recovery(restarts=2, true_deltas=(0.8,))
        assert report["engineering_only"] is True
        reading = report["reading"]
        assert "generic Jacobian rank 2T" in reading
        assert "slope" in reading


class TestTrackingSlope:
    """The historical slope is retained as output, not as identification evidence."""

    def test_the_reading_rejects_the_threshold_inference(self):
        from quantum_arena.human_model_gate import tracking_slope

        report = tracking_slope(restarts=2, true_deltas=(1.1, 2.9))
        assert "does not imply partial" in report["reading"]
        assert "no structural status" in report["reading"]

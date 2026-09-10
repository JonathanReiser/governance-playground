import math

import numpy as np
import pytest

from quantum_arena.protocol import MAX_ENTANGLEMENT, unitary
from quantum_arena.su2_stress import (
    EXPLOITABILITY_TOLERANCE,
    I_SIGMA_X,
    I_SIGMA_X_PARAMETERS,
    Q_OPERATION,
    SCHEMA,
    SearchConfig,
    evaluate_deviation,
    operation_is_su2,
    probabilities_for_operations,
    restricted_menu_baseline,
    run_stress_test,
    search_deviation,
    su2,
    validate_against_v1,
)


class TestFullSU2Parameterisation:
    @pytest.mark.parametrize("parameters", [
        (0.0, 0.0, 0.0),
        (math.pi / 2, 0.0, 0.0),
        (0.0, math.pi, math.pi / 2),
        (-math.pi, math.pi / 3, math.pi),
        (math.pi, math.pi, -math.pi),
    ])
    def test_every_adversarial_point_is_special_unitary(self, parameters):
        operation = su2(*parameters)
        assert operation_is_su2(operation)
        assert np.allclose(operation.conj().T @ operation, np.eye(2), atol=1e-12)
        assert np.linalg.det(operation) == pytest.approx(1.0, abs=1e-12)

    def test_ewl_family_is_an_exact_slice(self):
        for theta in np.linspace(0.0, math.pi, 9):
            for phi in np.linspace(0.0, math.pi / 2, 7):
                assert np.allclose(su2(float(phi), float(theta), 0.0), unitary(float(theta), float(phi)), atol=1e-12)

    def test_refuses_non_finite_or_out_of_domain_parameters(self):
        for parameters in [(-4.0, 0.0, 0.0), (0.0, -0.1, 0.0), (0.0, math.pi + 0.1, 0.0), (0.0, 0.0, math.inf)]:
            with pytest.raises(ValueError):
                su2(*parameters)


class TestFrozenV1Compatibility:
    def test_entire_frozen_menu_matches_at_seven_gammas(self):
        report = validate_against_v1()
        assert report["ewl_slice_matches_v1"]
        assert report["probabilities_match_v1"]
        assert report["worst_ewl_slice_error"] < 1e-12
        assert report["worst_probability_error"] < 1e-12

    def test_asymmetric_profiles_are_not_bit_swapped(self):
        x_deviation = probabilities_for_operations(I_SIGMA_X, Q_OPERATION, MAX_ENTANGLEMENT)
        o_deviation = probabilities_for_operations(Q_OPERATION, I_SIGMA_X, MAX_ENTANGLEMENT)
        assert x_deviation["DC"] == pytest.approx(1.0, abs=1e-12)
        assert x_deviation["CD"] == pytest.approx(0.0, abs=1e-12)
        assert o_deviation["CD"] == pytest.approx(1.0, abs=1e-12)
        assert o_deviation["DC"] == pytest.approx(0.0, abs=1e-12)


class TestProfitableDeviation:
    def test_q_q_is_still_an_equilibrium_before_expanding_the_menu(self):
        baseline = restricted_menu_baseline()
        assert baseline["stage"] == "A1-frozen-menu"
        assert baseline["candidate_is_equilibrium"] is True
        assert baseline["exploitability"] == pytest.approx(0.0, abs=1e-12)

    def test_closed_form_witness_breaks_q_q_for_both_seats(self):
        for seat in ("X", "O"):
            witness = evaluate_deviation(I_SIGMA_X_PARAMETERS, seat)
            assert witness["is_su2"]
            assert witness["deviator_payoff"] == pytest.approx(2 / 3, abs=1e-12)

    @pytest.mark.parametrize("seat", ["X", "O"])
    def test_independent_search_finds_the_witness(self, seat):
        # Small CI budget; fixed boundary anchors still evaluate the exact
        # counterexample while both numerical optimizers run independently.
        config = SearchConfig(
            seed=0,
            sobol_power=8,
            local_starts=4,
            differential_evolution_maxiter=20,
            differential_evolution_popsize=6,
        )
        result = search_deviation(seat, config)
        assert result["witness"]["gain_over_candidate"] > EXPLOITABILITY_TOLERANCE
        assert result["witness"]["deviator_payoff"] == pytest.approx(2 / 3, abs=1e-8)
        assert result["known_closed_form_witness"]["gain_over_candidate"] == pytest.approx(2 / 3, abs=1e-12)
        assert result["search_evidence"]["sobol"]["points"] == 256
        assert result["search_evidence"]["local_L-BFGS-B"]["starts"] == 4
        assert result["search_evidence"]["differential_evolution"]["evaluations"] > 0

    def test_record_is_separate_and_does_not_overclaim(self):
        config = SearchConfig(
            seed=0,
            sobol_power=6,
            local_starts=2,
            differential_evolution_maxiter=5,
            differential_evolution_popsize=4,
        )
        record = run_stress_test(config)
        assert record["schema"] == SCHEMA
        assert record["schema"] != "quantum-arena-play/v1"
        assert record["engineering_only"] is True
        assert record["preregistered_experiment"] is False
        assert record["candidate_is_equilibrium_in_tested_space"] is False
        assert record["exploitability"] == pytest.approx(2 / 3, abs=1e-8)
        assert record["restricted_menu_baseline"]["candidate_is_equilibrium"] is True
        assert record["v1_compatibility"]["probabilities_match_v1"] is True
        assert "not evidence for or against quantum cognition" in record["claim_boundary"]
        assert record["classical_comparator"]["shared_randomness_allowed"] is True

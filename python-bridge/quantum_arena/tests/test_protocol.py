import itertools

import numpy as np
import pytest

from quantum_arena.hardware import build_circuit, empirical_distribution, execute
from quantum_arena.payoffs import expected_payoffs, is_prisoners_dilemma, pure_nash, to_canonical
from quantum_arena.protocol import (
    BASIS, FLIP, MAX_ENTANGLEMENT, MENU, entangler, outcome_probabilities, unitary,
)

GAMMAS = np.linspace(0.0, MAX_ENTANGLEMENT, 41)


class TestClassicalEmbedding:
    """The property that makes this EWL rather than EWL-shaped."""

    @pytest.mark.parametrize("x_op,o_op,expected", [
        ("C", "C", "CC"), ("C", "D", "CD"), ("D", "C", "DC"), ("D", "D", "DD"),
    ])
    def test_corner_is_recovered_at_every_gamma(self, x_op, o_op, expected):
        for gamma in GAMMAS:
            p = outcome_probabilities(MENU[x_op], MENU[o_op], gamma)
            assert p[expected] == pytest.approx(1.0, abs=1e-12), f"broke at gamma={gamma}"

    def test_a_sigma_x_generated_entangler_would_break_the_asymmetric_corners(self):
        """Draft 0.1's exact bug, pinned as a regression test.

        J built from sigma_x instead of the flip strategy inverts (C,D) and (D,C)
        at maximal entanglement. If someone 'simplifies' the generator back, the
        corner test above fails — this asserts the failure mode is real rather
        than hypothetical, so the guard is never mistaken for superstition.
        """
        sigma_x = np.array([[0, 1], [1, 0]], dtype=complex)
        gamma = MAX_ENTANGLEMENT
        wrong = np.cos(gamma / 2) * np.eye(4) + 1j * np.sin(gamma / 2) * np.kron(sigma_x, sigma_x)
        psi = wrong.conj().T @ np.kron(unitary(*MENU["C"]), unitary(*MENU["D"])) @ wrong @ np.array([1, 0, 0, 0], dtype=complex)
        probabilities = dict(zip(BASIS, np.abs(psi) ** 2))
        assert probabilities["CD"] == pytest.approx(0.0, abs=1e-12)
        assert probabilities["DC"] == pytest.approx(1.0, abs=1e-12)  # fully inverted

    def test_phase_cannot_move_probabilities_at_gamma_zero(self):
        for theta_x, theta_o in itertools.product([0.0, np.pi / 3, np.pi], repeat=2):
            base = outcome_probabilities((theta_x, 0.0), (theta_o, 0.0), 0.0)
            for phi_x, phi_o in itertools.product([0.0, np.pi / 4, np.pi / 2], repeat=2):
                other = outcome_probabilities((theta_x, phi_x), (theta_o, phi_o), 0.0)
                for key in BASIS:
                    assert other[key] == pytest.approx(base[key], abs=1e-12)


class TestUnitarityAndDomain:
    def test_u_and_j_are_unitary(self):
        for theta in np.linspace(0, np.pi, 15):
            for phi in np.linspace(0, np.pi / 2, 9):
                u = unitary(theta, phi)
                assert np.allclose(u.conj().T @ u, np.eye(2), atol=1e-12)
        for gamma in GAMMAS:
            j = entangler(gamma)
            assert np.allclose(j.conj().T @ j, np.eye(4), atol=1e-12)

    @pytest.mark.parametrize("theta,phi", [(-0.1, 0.0), (np.pi + 0.1, 0.0), (0.0, -0.1), (0.0, np.pi)])
    def test_out_of_domain_parameters_are_refused(self, theta, phi):
        with pytest.raises(ValueError):
            unitary(theta, phi)

    @pytest.mark.parametrize("gamma", [-0.1, np.pi])
    def test_out_of_domain_gamma_is_refused(self, gamma):
        with pytest.raises(ValueError):
            entangler(gamma)

    def test_flip_is_the_theta_pi_strategy(self):
        assert np.allclose(FLIP, unitary(np.pi, 0.0))


class TestMenuIsFrozen:
    def test_exact_menu(self):
        assert MENU == {
            "C": (0.0, 0.0),
            "D": (np.pi, 0.0),
            "M": (np.pi / 2, 0.0),
            "Q": (0.0, np.pi / 2),
        }

    def test_q_is_indistinguishable_from_c_without_entanglement(self):
        """Q's whole content is phase, and phase does nothing at gamma = 0."""
        for other in MENU.values():
            assert outcome_probabilities(MENU["Q"], other, 0.0) == pytest.approx(
                outcome_probabilities(MENU["C"], other, 0.0)
            )

    def test_q_is_distinguishable_from_c_with_entanglement(self):
        differs = any(
            abs(outcome_probabilities(MENU["Q"], other, MAX_ENTANGLEMENT)[k]
                - outcome_probabilities(MENU["C"], other, MAX_ENTANGLEMENT)[k]) > 1e-9
            for other in MENU.values() for k in BASIS
        )
        assert differs


class TestPayoffs:
    def test_matrix_is_a_strict_prisoners_dilemma(self):
        verdict = is_prisoners_dilemma()
        assert verdict["ordering_T_gt_R_gt_P_gt_S"]
        assert verdict["mutual_cooperation_beats_alternating"]

    def test_affine_map_lands_on_the_canonical_ewl_matrix(self):
        assert [to_canonical(v) for v in is_prisoners_dilemma()["T_R_P_S"]] == pytest.approx([5.0, 3.0, 1.0, 0.0])

    def test_a_distribution_missing_a_profile_is_refused(self):
        with pytest.raises(ValueError):
            expected_payoffs({"CC": 1.0})

    def test_equilibrium_moves_from_mutual_defection_to_mutual_q(self):
        def table(gamma):
            return {
                (x, o): expected_payoffs(outcome_probabilities(MENU[x], MENU[o], gamma))
                for x, o in itertools.product(MENU, repeat=2)
            }
        classical = pure_nash(table(0.0))
        assert [e["profile"] for e in classical] == [("D", "D")]
        assert classical[0]["payoffs"] == pytest.approx((-2 / 3, -2 / 3))

        entangled = pure_nash(table(MAX_ENTANGLEMENT))
        assert [e["profile"] for e in entangled] == [("Q", "Q")]
        assert entangled[0]["payoffs"] == pytest.approx((0.0, 0.0), abs=1e-12)


class TestCircuitMatchesTheReference:
    """The circuit and the reference are separate implementations by design."""

    @pytest.mark.parametrize("x_op,o_op,gamma", [
        ("M", "C", 0.0), ("C", "M", MAX_ENTANGLEMENT), ("M", "M", MAX_ENTANGLEMENT / 2),
        ("Q", "D", MAX_ENTANGLEMENT), ("D", "Q", MAX_ENTANGLEMENT),
    ])
    def test_sampled_distribution_matches_born_probabilities(self, x_op, o_op, gamma):
        reading = execute(MENU[x_op], MENU[o_op], gamma, shots=40000)
        empirical = empirical_distribution(reading)
        exact = outcome_probabilities(MENU[x_op], MENU[o_op], gamma)
        for key in BASIS:
            assert empirical[key] == pytest.approx(exact[key], abs=0.02)

    def test_bit_order_is_not_swapped(self):
        """M vs C and C vs M are mirror images. A CD/DC swap makes them identical."""
        x_mixes = outcome_probabilities(MENU["M"], MENU["C"], 0.0)
        o_mixes = outcome_probabilities(MENU["C"], MENU["M"], 0.0)
        assert x_mixes["DC"] == pytest.approx(0.5) and x_mixes["CD"] == pytest.approx(0.0)
        assert o_mixes["CD"] == pytest.approx(0.5) and o_mixes["DC"] == pytest.approx(0.0)

    def test_circuit_has_two_qubits_and_measures_both(self):
        circuit = build_circuit(MENU["Q"], MENU["Q"], MAX_ENTANGLEMENT)
        assert circuit.num_qubits == 2 and circuit.num_clbits == 2

    def test_without_a_token_the_reading_says_simulator(self):
        reading = execute(MENU["C"], MENU["C"], 0.0, shots=10, token=None)
        assert reading["simulator"] is True
        assert reading["backend"] == "aer_simulator"
        assert "backend_pinned" not in reading  # never mistakable for a QPU run

    def test_shots_must_be_positive(self):
        with pytest.raises(ValueError):
            execute(MENU["C"], MENU["C"], 0.0, shots=0)

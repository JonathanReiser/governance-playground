"""
Tests for instinct_qpu.py. Everything here exercises the local Aer
simulator path only — no IBM_QUANTUM_TOKEN, no network call, no real
hardware. That's a deliberate scope limit, not an oversight: the
real-hardware branch (_run_on_real_hardware) is structurally reviewed but
genuinely untested, since no valid token was available while building
this (see instinct_qpu.py's own module docstring). Run this file once a
real token exists and it's worth adding a live (skippable, marked
slow/network) test for that branch specifically.
"""

import math

import pytest
from qiskit_aer import AerSimulator
from qiskit.quantum_info import Statevector

from instinct_qpu import (
    build_instinct_circuit,
    pressure_to_theta,
    read_instinct,
)


class TestPressureToTheta:
    def test_anchors_pressure_0_at_fully_allow_and_100_at_fully_veto(self):
        # Same regression this locks down in instinct.js's own test suite:
        # an earlier draft's mapping wasn't monotonic. Verified here via
        # exact statevector probability, not sampling — matching
        # instinct.js's own precedent of checking the math directly.
        circuit0 = build_instinct_circuit(pressure=0)
        circuit0.remove_final_measurements()
        sv0 = Statevector(circuit0)
        assert sv0.probabilities([0])[1] == pytest.approx(1.0, abs=1e-9)  # P(ALLOW) = 1

        circuit100 = build_instinct_circuit(pressure=100)
        circuit100.remove_final_measurements()
        sv100 = Statevector(circuit100)
        assert sv100.probabilities([0])[1] == pytest.approx(0.0, abs=1e-9)  # P(ALLOW) = 0

    def test_pressure_50_is_an_honest_50_50(self):
        circuit = build_instinct_circuit(pressure=50)
        circuit.remove_final_measurements()
        sv = Statevector(circuit)
        assert sv.probabilities([0])[1] == pytest.approx(0.5, abs=1e-9)

    def test_monotonic_non_increasing_in_p_allow_as_pressure_rises(self):
        pressures = [0, 10, 25, 40, 50, 60, 75, 90, 100]
        readings = []
        for p in pressures:
            c = build_instinct_circuit(pressure=p)
            c.remove_final_measurements()
            readings.append(Statevector(c).probabilities([0])[1])
        for i in range(1, len(readings)):
            assert readings[i] <= readings[i - 1] + 1e-9

    def test_matches_the_exact_formula_at_an_arbitrary_point(self):
        # P(ALLOW) = 1 - pressure/100
        assert math.sin(pressure_to_theta(30) / 2) ** 2 == pytest.approx(0.7, abs=1e-9)


class TestBuildInstinctCircuit:
    def test_standalone_circuit_has_exactly_one_qubit(self):
        c = build_instinct_circuit(pressure=50)
        assert c.num_qubits == 1

    def test_entangled_circuit_has_exactly_two_qubits_and_a_cx_gate(self):
        c = build_instinct_circuit(pressure=50, entangled_readout=0.7)
        assert c.num_qubits == 2
        gate_names = [inst.operation.name for inst in c.data]
        assert "cx" in gate_names

    def test_entanglement_reproduces_this_paper_precise_algebra(self):
        # Same worked-out relationship instinct.js's own tests lock down:
        # entangled_readout=1 reproduces the unentangled reading exactly;
        # entangled_readout=0 flips it. Checked via exact statevector
        # probabilities, not sampling.
        alone = build_instinct_circuit(pressure=80)
        alone.remove_final_measurements()
        p_alone = Statevector(alone).probabilities([0])[1]

        partner_hardline = build_instinct_circuit(pressure=80, entangled_readout=1)
        partner_hardline.remove_final_measurements()
        p_hardline = Statevector(partner_hardline).probabilities([0])[1]
        assert p_hardline == pytest.approx(p_alone, abs=1e-9)

        partner_calm = build_instinct_circuit(pressure=80, entangled_readout=0)
        partner_calm.remove_final_measurements()
        p_calm = Statevector(partner_calm).probabilities([0])[1]
        assert p_calm == pytest.approx(1 - p_alone, abs=1e-9)


class TestReadInstinct:
    def test_no_token_falls_back_to_simulator_honestly_labeled(self, monkeypatch):
        monkeypatch.delenv("IBM_QUANTUM_TOKEN", raising=False)
        reading = read_instinct(pressure=50)
        assert reading["simulator"] is True
        assert reading["backend"] == "aer_simulator"
        assert reading["job_id"] is None
        assert "no IBM_QUANTUM_TOKEN" in reading["detail"]
        assert reading["outcome"] in ("VETO", "ALLOW")

    def test_a_bad_token_falls_back_to_simulator_rather_than_crashing(self):
        # Exercises the real-hardware call path's failure branch (a real
        # connection attempt with an invalid token) without needing a
        # valid one — confirms the fallback degrades gracefully rather
        # than raising, which is the property that matters for this
        # module never being allowed to crash a governance cycle.
        reading = read_instinct(pressure=50, token="not-a-real-token")
        assert reading["simulator"] is True
        assert "IBM hardware call failed" in reading["detail"]
        assert reading["outcome"] in ("VETO", "ALLOW")

    def test_reading_carries_the_inputs_that_produced_it(self):
        reading = read_instinct(pressure=82, entangled_readout=0.7)
        assert reading["pressure"] == 82
        assert reading["entangled_readout"] == 0.7

    def test_deterministic_extreme_pressures_still_go_through_a_real_measurement(self):
        # Even at pressure=0 (should always measure ALLOW) this is a REAL
        # single-shot measurement on the simulator, not a shortcut —
        # confirms the full circuit+measure+extract path runs cleanly at
        # both extremes, not just in the middle.
        allow_reading = read_instinct(pressure=0)
        assert allow_reading["outcome"] == "ALLOW"
        veto_reading = read_instinct(pressure=100)
        assert veto_reading["outcome"] == "VETO"

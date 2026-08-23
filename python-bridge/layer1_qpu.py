"""
layer1_qpu.py — Tier 2 for the actual flagship mechanism: Iran/Israel's
entangled political collapse (Layer 1), not just the instinct veto.

Companion to frontend/src/lib/quantum.js and agents.js's evolveQuantumState/
evolveAndCollapseQuantumState. That mechanism tracks a real 2-qubit joint
statevector classically (unitary rotations, exact complex-amplitude math)
and, at commit, samples it via a two-step classical procedure: measureA()
Born-rule-samples qubit A first, then collapseQubit() conditionally
samples qubit B given A's outcome. Correct math, faithfully simulating a
joint measurement — but still computed, not measured.

This module instead: takes the EXACT tracked joint statevector at the
moment of commit, prepares that state on 2 real qubits via Qiskit's
StatePreparation (a standard, exact technique for a 2-qubit target state
— not approximate, not experimental), and measures both qubits in ONE
real physical shot. The result is a genuine joint measurement of an
actually-entangled 2-qubit system, not two sequential classical samples
of a classically-tracked joint distribution.

STAKES ARE HIGHER HERE THAN instinct_qpu.py. That module's readings are
side-channel, human-reviewable only — never fed into simState or the
on-chain commit. THIS module's output, when the frontend's Tier 2 toggle
is on, directly replaces the classical measureA()+collapseQubit()
outcome that DOES feed the committed political collapse (entangledEffect,
the on-chain stability/conflict deltas). Real hardware noise here changes
the actual citable research record, not just a display — see
agents.js's evolveAndCollapseQuantumStateViaQPU, which records
collapseSource on every event specifically so this is never silently
uniform with the classical path.

BIT-ORDERING — the one place a mistake here would silently corrupt the
research record rather than crash loudly, so it gets its own section and
its own concrete regression test (see tests/test_layer1_qpu.py):

quantum.js's joint array is [q00, q01, q10, q11], index = A*2 + B (A is
the doubled/more-significant term — see agents.js's packageCollapseResult:
`oneHot[aOutcomeIndex * 2 + bOutcomeIndex] = 1`).

Qiskit's Statevector convention for an n-qubit circuit: data[i]'s bits
read qubit(n-1) as the MOST significant bit of i, down to qubit 0 as the
LEAST significant bit. For 2 qubits: index = 2*qubit1_value + qubit0_value.

Mapping qubit index 1 -> "A", qubit index 0 -> "B" makes Qiskit's own
index formula (2*qubit1 + qubit0) read as (2*A + B) — IDENTICAL to
quantum.js's convention. No reordering of the amplitude array is needed;
passing quantum.js's [q00,q01,q10,q11] straight into Qiskit's Statevector
constructor is already correct under this qubit-role assignment. Getting
this qubit-role choice backwards (A on qubit 0 instead of qubit 1) would
silently swap the middle two amplitudes' meaning (A0B1 <-> A1B0) — same
class of bug as this project's earlier channel="ibm_quantum" mistake,
except this one wouldn't throw, it would just be wrong. Verified with a
concrete asymmetric test state, not just this derivation.
"""

import math
import os
import time

from qiskit import QuantumCircuit, transpile
from qiskit.quantum_info import Statevector
from qiskit_aer import AerSimulator


def build_state_prep_circuit(joint_amplitudes: list[dict]) -> QuantumCircuit:
    """
    joint_amplitudes: 4 {"re": float, "im": float} dicts, quantum.js's
    [A0B0, A0B1, A1B0, A1B1] order. Qubit 1 = A, qubit 0 = B (see module
    docstring for why this needs no reordering).
    """
    if len(joint_amplitudes) != 4:
        raise ValueError(f"expected exactly 4 amplitudes for a 2-qubit joint state, got {len(joint_amplitudes)}")

    complex_amps = [complex(a["re"], a["im"]) for a in joint_amplitudes]
    norm = math.sqrt(sum(abs(a) ** 2 for a in complex_amps))
    if not math.isclose(norm, 1.0, abs_tol=1e-6):
        raise ValueError(f"joint state is not normalized (|amplitude|^2 sums to {norm ** 2:.6f}, expected 1.0)")

    sv = Statevector(complex_amps)
    circuit = QuantumCircuit(2, 2, name="layer1_entangled_pair")
    circuit.prepare_state(sv, [0, 1])
    circuit.measure([0, 1], [0, 1])
    return circuit


def _outcome_from_counts(counts: dict) -> dict:
    bitstring = next(iter(counts))  # 1 shot -> exactly one key
    value = int(bitstring, 2)
    return {"a_outcome": (value >> 1) & 1, "b_outcome": value & 1}


def _run_on_simulator(circuit: QuantumCircuit, detail: str | None = None) -> dict:
    sim = AerSimulator()
    transpiled = transpile(circuit, sim)
    job = sim.run(transpiled, shots=1)
    counts = job.result().get_counts()
    reading = _outcome_from_counts(counts)
    reading.update({"backend": "aer_simulator", "simulator": True, "job_id": None})
    if detail:
        reading["detail"] = detail
    return reading


def _run_on_real_hardware(circuit: QuantumCircuit, token: str) -> dict:
    from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2

    service = QiskitRuntimeService(channel="ibm_quantum_platform", token=token)
    backend = service.least_busy(simulator=False, operational=True)
    transpiled = transpile(circuit, backend)

    sampler = SamplerV2(mode=backend)
    job = sampler.run([transpiled], shots=1)
    job_id = job.job_id()
    result = job.result()

    counts = result[0].data.c.get_counts()
    reading = _outcome_from_counts(counts)
    reading.update({"backend": backend.name, "simulator": False, "job_id": job_id})
    return reading


def collapse_entangled_pair(joint_amplitudes: list[dict], token: str | None = None) -> dict:
    """
    The one function this module exists to provide. Builds the state-prep
    circuit for the exact joint amplitudes handed in, tries real IBM
    hardware if a token is available, falls back to a local simulator on
    any failure, always labels which one actually produced the reading.
    """
    circuit = build_state_prep_circuit(joint_amplitudes)
    token = token if token is not None else os.environ.get("IBM_QUANTUM_TOKEN")

    if not token:
        reading = _run_on_simulator(circuit, detail="no IBM_QUANTUM_TOKEN set in this environment")
    else:
        started = time.monotonic()
        try:
            reading = _run_on_real_hardware(circuit, token)
        except Exception as err:  # noqa: BLE001 — any failure here should degrade, not crash a live commit
            reading = _run_on_simulator(circuit, detail=f"IBM hardware call failed: {err}")
        reading["elapsed_seconds"] = round(time.monotonic() - started, 2)

    return reading

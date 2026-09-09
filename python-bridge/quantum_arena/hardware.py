"""Execution of the arena circuit, on the pinned backend or a local simulator.

The protocol module computes the state exactly; this runs it. They are separate
implementations on purpose, so validation item 5's independence is real and the
hardware path can be checked against a reference it does not share code with.
"""

from __future__ import annotations

import os
import time

import numpy as np
from qiskit import QuantumCircuit, transpile
from qiskit.quantum_info import Operator
from qiskit_aer import AerSimulator

from .protocol import BASIS, entangler, unitary

# Same pin, same reasoning, as layer1_qpu.py and instinct_qpu.py: least_busy
# returns whichever device is free, so two runs of one circuit can land on
# different hardware with different noise. ibm_marrakesh is the backend this
# project has actually executed on (verified live 2026-08-23, job id
# da5j2s6aa69c739ku7a0).
DEFAULT_BACKEND = "ibm_marrakesh"


def build_circuit(operation_x, operation_o, gamma: float) -> QuantumCircuit:
    """J^dagger (U_X (x) U_O) J |00>, measured in the computational basis.

    Qubit 1 carries X's policy and qubit 0 carries O's, so Qiskit's own index
    convention (index = 2*q1 + q0) reads directly as [CC, CD, DC, DD] and needs
    no reordering. Getting this backwards would not throw — it would silently
    swap CD and DC — so it has its own regression test.
    """
    j = entangler(gamma)
    circuit = QuantumCircuit(2, 2, name="quantum_policy_arena")
    circuit.unitary(Operator(j), [0, 1], label="J")
    circuit.unitary(Operator(unitary(*operation_o)), [0], label="U_O")
    circuit.unitary(Operator(unitary(*operation_x)), [1], label="U_X")
    circuit.unitary(Operator(j.conj().T), [0, 1], label="J_dg")
    circuit.measure([0, 1], [0, 1])
    return circuit


def _label(bitstring: str) -> str:
    # Qiskit returns clbits little-endian: c1 c0, i.e. X's bit then O's.
    return BASIS[int(bitstring, 2)]


def _run_on_simulator(circuit, shots: int, detail: str | None = None) -> dict:
    simulator = AerSimulator()
    counts = simulator.run(transpile(circuit, simulator), shots=shots).result().get_counts()
    reading = {
        "counts": {_label(b): c for b, c in counts.items()},
        "shots": shots,
        "backend": "aer_simulator",
        "simulator": True,
        "job_id": None,
    }
    if detail:
        reading["detail"] = detail
    return reading


def _run_on_hardware(circuit, shots: int, token: str) -> dict:
    from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2

    service = QiskitRuntimeService(channel="ibm_quantum_platform", token=token)
    requested = os.environ.get("IBM_QUANTUM_BACKEND", DEFAULT_BACKEND)
    backend = service.backend(requested)
    if backend is None:
        raise RuntimeError(f"pinned backend {requested!r} is not available to this account")

    transpiled = transpile(circuit, backend)
    job = SamplerV2(mode=backend).run([transpiled], shots=shots)
    job_id = job.job_id()
    counts = job.result()[0].data.c.get_counts()
    return {
        "counts": {_label(b): c for b, c in counts.items()},
        "shots": shots,
        "backend": backend.name,
        "backend_requested": requested,
        "backend_pinned": backend.name == requested,
        "simulator": False,
        "job_id": job_id,
        # Validation item 8: mitigation is a many-shot correction with no
        # single-shot meaning. Raw counts only; a mitigated view is a separate
        # record, never a relabelling of this one.
        "readout_mitigation": "none (raw counts)",
    }


def execute(operation_x, operation_o, gamma: float, shots: int = 1024, token: str | None = None) -> dict:
    """Run one arena circuit.

    Falls back to the local simulator when no token is set or the hardware call
    fails — labelled, never silently. If the PINNED backend is unavailable this
    degrades to the simulator rather than to a different QPU: saying "simulator"
    is honest, saying nothing while sampling other hardware is not.
    """
    if shots < 1:
        raise ValueError("shots must be at least 1")
    circuit = build_circuit(operation_x, operation_o, gamma)
    token = token if token is not None else os.environ.get("IBM_QUANTUM_TOKEN")

    if not token:
        return _run_on_simulator(circuit, shots, "no IBM_QUANTUM_TOKEN set in this environment")

    started = time.monotonic()
    try:
        reading = _run_on_hardware(circuit, shots, token)
    except Exception as error:  # noqa: BLE001 — degrade, never crash a live run
        reading = _run_on_simulator(circuit, shots, f"hardware call failed: {error}")
    reading["elapsed_seconds"] = round(time.monotonic() - started, 2)
    return reading


def empirical_distribution(reading: dict) -> dict[str, float]:
    total = sum(reading["counts"].values())
    return {name: reading["counts"].get(name, 0) / total for name in BASIS}

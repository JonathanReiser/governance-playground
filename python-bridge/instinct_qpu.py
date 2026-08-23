"""
instinct_qpu.py — Tier 2: the instinct-layer circuit, on real qubits.

Companion to frontend/src/lib/instinct.js. That file's own "ON GENUINE
INDETERMINACY" note explains Tier 1 (real ANU/NIST entropy sampling a
classically-simulated probability) and names this as the open Tier 2 item:
running the ACTUAL RY/CX circuit — including the entangling gate — on a
real IBM quantum processor, not a simulation of one.

WHAT'S DIFFERENT HERE, WORTH BEING PRECISE ABOUT: instinct.js's Tier 1
had to work AROUND quantum-circuit's own measure() being Math.random()-
backed — it reads a deterministic probability off the simulator and takes
its OWN sample via a real entropy source, specifically to avoid a fake
measurement. On real hardware, that workaround isn't needed at all: a
genuine measurement on a real QPU IS the physical collapse — there's no
probability to read and separately sample, because the qubit's state
isn't a number sitting in memory here, it's a real physical system that
gets measured once and gives one real outcome. This is architecturally
simpler than Tier 1, not just "more real" — one fewer layer of
indirection, because the thing Tier 1 had to approximate is genuinely
happening.

MIRRORS instinct.js's own circuit exactly (see that file's THE CIRCUIT
section) — same pressureToTheta mapping, same qubit count, same CX
direction — so a reading from here is comparable to a Tier 1 reading, not
a different circuit wearing the same name.

FALLBACK: no IBM_QUANTUM_TOKEN set, or the real-hardware call fails for
any reason (network, queue, API drift), falls back to a local Aer
simulator — honestly labeled (`simulator: true`, `detail` explains why),
never silently presented as real hardware. Same discipline as
quantumRng.js's ANU fallback.

VERIFIED LIVE, 2026-08-23, against real IBM hardware (backend
`ibm_marrakesh`) — not just structurally reviewed. First run caught a
real bug before it shipped: the `channel="ibm_quantum"` this module was
originally written against has been fully removed by IBM (migrated to
Cloud IAM-based auth); the correct current value is
`"ibm_quantum_platform"` (confirmed against the installed
qiskit-ibm-runtime's own default). Fixed, then reran: a standalone
reading (pressure=82, entangledReadout=0.7) returned a real job id
(`da5j2s6aa69c739ku7a0`) and outcome; both deterministic extremes
(pressure=0 -> ALLOW, pressure=100 -> VETO) came back correct on real
hardware with no visible readout error on those particular shots. See
tests/test_instinct_qpu.py's TestRealHardwareLive for the regression
tests this landed as (skipped automatically without a token, so CI stays
token-free; exercised for real whenever run locally with one).
"""

import math
import os
import time

from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator


def pressure_to_theta(pressure_value: float) -> float:
    """
    Exact port of instinct.js's pressureToTheta() — see that file for the
    derivation. P(ALLOW) = 1 - pressure/100 exactly.
    """
    allow_probability = 1 - min(1.0, max(0.0, pressure_value / 100.0))
    return 2 * math.asin(math.sqrt(allow_probability))


def build_instinct_circuit(pressure: float, entangled_readout: float | None = None) -> QuantumCircuit:
    """
    Exact port of instinct.js's buildInstinctCircuit(), plus a measurement
    (which the JS version deliberately omits — see that file's "ON GENUINE
    INDETERMINACY" note for why; here a measurement IS the whole point).

    |0> = VETO, |1> = ALLOW, same convention as instinct.js. Wire 0 is
    always this nation's instinct qubit; wire 1 (if present) carries the
    entangled partner's readout, coupled via CX(control=1, target=0) —
    same direction as instinct.js's `cx(1, [1, 0])`.
    """
    n_qubits = 2 if entangled_readout is not None else 1
    circuit = QuantumCircuit(n_qubits, 1, name="instinct")

    circuit.ry(pressure_to_theta(pressure), 0)

    if entangled_readout is not None:
        circuit.ry(pressure_to_theta(entangled_readout * 100), 1)
        circuit.cx(1, 0)  # control = partner's wire, target = this nation's instinct wire

    circuit.measure(0, 0)
    return circuit


def _outcome_from_counts(counts: dict) -> dict:
    """
    counts is a {bitstring: count} dict from a 1-shot run — exactly one
    key will have count 1. Extract that single real outcome.
    """
    bitstring = next(iter(counts))
    bit = int(bitstring[-1])  # rightmost bit = classical bit 0, Qiskit's convention
    return {"outcome": "ALLOW" if bit == 1 else "VETO", "outcome_bit": bit}


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
    # Imported lazily — qiskit_ibm_runtime pulls in a network client; no
    # reason to import it (or require it be installed) on the pure-
    # simulator path, which is the only one this project's automated
    # tests actually exercise.
    from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2

    # "ibm_quantum" was the channel name at the time this module's docstring
    # was written and is now REMOVED entirely (confirmed live, 2026-08-23,
    # against qiskit-ibm-runtime 0.49.0 — the exact error was: "'channel'
    # can only be 'ibm_cloud', or 'ibm_quantum_platform"). IBM migrated to
    # Cloud IAM-based auth; "ibm_quantum_platform" is the current default
    # (qiskit_ibm_runtime.accounts.management._DEFAULT_CHANNEL_TYPE).
    service = QiskitRuntimeService(channel="ibm_quantum_platform", token=token)
    backend = service.least_busy(simulator=False, operational=True)
    transpiled = transpile(circuit, backend)

    sampler = SamplerV2(mode=backend)
    job = sampler.run([transpiled], shots=1)
    job_id = job.job_id()
    result = job.result()

    # PubResult's data container is named after the circuit's classical
    # register ("c", set explicitly in build_instinct_circuit above) —
    # pinning the name there specifically so this lookup isn't guessing.
    counts = result[0].data.c.get_counts()
    reading = _outcome_from_counts(counts)
    reading.update({"backend": backend.name, "simulator": False, "job_id": job_id})
    return reading


def read_instinct(pressure: float, entangled_readout: float | None = None, token: str | None = None) -> dict:
    """
    The one function this module exists to provide. Builds the circuit,
    tries real IBM hardware if a token is available (env var
    IBM_QUANTUM_TOKEN, or passed explicitly — e.g. for tests), falls back
    to a local simulator on any failure, always labels which one actually
    produced the reading.
    """
    circuit = build_instinct_circuit(pressure, entangled_readout)
    token = token if token is not None else os.environ.get("IBM_QUANTUM_TOKEN")

    if not token:
        reading = _run_on_simulator(circuit, detail="no IBM_QUANTUM_TOKEN set in this environment")
    else:
        started = time.monotonic()
        try:
            reading = _run_on_real_hardware(circuit, token)
        except Exception as err:  # noqa: BLE001 — any failure here should degrade, not crash a reading
            reading = _run_on_simulator(circuit, detail=f"IBM hardware call failed: {err}")
        reading["elapsed_seconds"] = round(time.monotonic() - started, 2)

    reading["pressure"] = pressure
    reading["entangled_readout"] = entangled_readout
    return reading

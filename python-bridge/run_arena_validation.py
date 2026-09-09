#!/usr/bin/env python3
"""Execute a preregistered arena validation on real hardware. Reads JSON on stdin.

Called by scripts/prereg-arena.js. Publishes raw counts only — mitigation is a
many-shot correction reported separately, never substituted for these.

Refuses to fall back. Every other hardware path in this project degrades to the
labelled simulator, which is right when a reading is a side channel. Here the
whole point is what the DEVICE did, so a fallback would publish simulator output
under a registration that promised hardware. It fails instead.
"""

import json
import os
import sys

from qiskit import transpile
from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2

from quantum_arena.hardware import build_circuit
from quantum_arena.protocol import BASIS, MENU, outcome_probabilities


def total_variation(empirical, exact):
    return 0.5 * sum(abs(empirical[k] - exact[k]) for k in BASIS)


def main() -> int:
    request = json.load(sys.stdin)
    token = os.environ.get("IBM_QUANTUM_TOKEN")
    if not token:
        print("IBM_QUANTUM_TOKEN is not set", file=sys.stderr)
        return 1

    service = QiskitRuntimeService(channel="ibm_quantum_platform", token=token)
    backend = service.backend(request["backend"])
    if backend is None or backend.name != request["backend"]:
        print(f"pinned backend {request['backend']!r} unavailable; abandoning the run", file=sys.stderr)
        return 1

    sampler = SamplerV2(mode=backend)
    shots = request["shots"]
    cells = []
    for cell in request["cells"]:
        operations = (MENU[cell["operationX"]], MENU[cell["operationO"]])
        circuit = build_circuit(*operations, cell["gamma"])
        transpiled = transpile(circuit, backend)
        job = sampler.run([transpiled], shots=shots)
        counts = job.result()[0].data.c.get_counts()

        named = {profile: 0 for profile in BASIS}
        for bitstring, count in counts.items():
            named[BASIS[int(bitstring, 2)]] += count
        empirical = {k: v / shots for k, v in named.items()}
        exact = outcome_probabilities(*operations, cell["gamma"])

        cells.append({
            **cell,
            "counts": named,
            "empirical": empirical,
            "exact": exact,
            "tvd": total_variation(empirical, exact),
            "shots": shots,
            "simulator": False,
            "backend": backend.name,
            "job_id": job.job_id(),
            "readout_mitigation": "none (raw counts)",
        })

    json.dump({"cells": cells, "backendReported": backend.name}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())

# python-bridge — Tier 2: instinct.js on real qubits

Companion to `frontend/src/lib/instinct.js`. Tier 1 (already shipped —
`quantumRng.js`) sources the instinct layer's final collapse from real
entropy (ANU QRNG / NIST Beacon), but the RY/CX circuit math itself —
including the entangling gate — is still classical simulation. This is
Tier 2: run that exact circuit on a real IBM quantum processor, so the
entanglement itself is physically real, not just correctly simulated.

## Status

**Structurally complete, not live-verified.** The local-simulator path
(`AerSimulator`) is fully tested — 11/11 pytest passing, including a test
that makes a REAL network call to IBM with a deliberately invalid token
and confirms the fallback degrades gracefully rather than crashing. The
real-hardware path (`_run_on_real_hardware` in `instinct_qpu.py`) is
written against the current `qiskit-ibm-runtime` API but has never
actually run against real IBM hardware — no valid `IBM_QUANTUM_TOKEN` was
available while building this (see the project's standing rule: API keys
are set by the user in their own environment, never handled directly).

**Before trusting the real-hardware path, run it once for real** with a
valid token and confirm the response shape matches what's documented
below — flag it here if anything about the Runtime API has drifted.

## Setup

```bash
cd python-bridge
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/python3 -m pytest tests/ -v   # 11 tests, no token needed, no network to IBM's real backend
```

To enable the real-hardware path, set your own token — **never through
Claude, never pasted into chat** — in your own shell or a gitignored
`.env` you create yourself:

```bash
export IBM_QUANTUM_TOKEN="your-token-from-quantum.ibm.com"
./venv/bin/python3 app.py
```

Without the token set, every reading transparently falls back to the
local simulator, labeled `"simulator": true` — the service always runs,
it just isn't reaching real hardware until a token is present.

## API

`POST /qpu-reading` — body `{"pressure": 0-100, "entangledReadout": 0-1 or omitted}`,
same inputs `instinct.js`'s `proposeVetoInstinct()` already computes.
Returns:

```json
{
  "outcome": "VETO" | "ALLOW",
  "outcome_bit": 0 | 1,
  "backend": "aer_simulator" | "<real IBM backend name>",
  "simulator": true | false,
  "job_id": null | "<real IBM job id, citable like a block number>",
  "detail": "<present only on the fallback path — why real hardware wasn't used>",
  "pressure": <echoed input>,
  "entangled_readout": <echoed input>
}
```

`GET /health` — `{"ok": true, "hasToken": true|false}`.

## Wiring into the rest of the project

`server.js` proxies `POST /api/instinct/qpu-reading` to this service
(`http://127.0.0.1:5001` by default, `PYTHON_BRIDGE_URL` to override) —
same pattern as `/api/agent/decide` proxying to Claude. **Not yet wired
into `agents.js`/`AICycleStep.jsx`'s actual UI** — that's the deliberate
next step once the real-hardware path has been verified live at least
once, not before. Wiring an unverified path into the review UI would be
the same mistake this whole project has been careful to avoid elsewhere:
showing something as more real than it's actually been shown to be.

## Running both services together

```bash
# Terminal 1
cd python-bridge && IBM_QUANTUM_TOKEN=... ./venv/bin/python3 app.py

# Terminal 2 (project root)
PYTHON_BRIDGE_URL=http://127.0.0.1:5001 npm run server
```

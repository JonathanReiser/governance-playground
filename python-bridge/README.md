# python-bridge — Tier 2: instinct.js on real qubits

Companion to `frontend/src/lib/instinct.js`. Tier 1 (already shipped —
`quantumRng.js`) sources the instinct layer's final collapse from real
entropy (ANU QRNG / NIST Beacon), but the RY/CX circuit math itself —
including the entangling gate — is still classical simulation. This is
Tier 2: run that exact circuit on a real IBM quantum processor, so the
entanglement itself is physically real, not just correctly simulated.

## Status

**Verified live against real IBM hardware, 2026-08-23** — backend
`ibm_marrakesh`, real job ids, not just structurally reviewed. The
first live run caught a real bug: `channel="ibm_quantum"` (what this
module was originally written against) has been fully removed by IBM —
migrated to Cloud IAM-based auth, current default is
`"ibm_quantum_platform"`. Fixed, then confirmed: a standalone entangled
reading returned a real job id and outcome, and both deterministic
extremes (pressure=0 → ALLOW, pressure=100 → VETO) came back correct on
real hardware with no visible readout error on those shots. See
`instinct_qpu.py`'s module docstring and `tests/test_instinct_qpu.py`'s
`TestRealHardwareLive` for the full detail and the regression tests this
landed as.

13/13 pytest passing locally with a token set (11 simulator-path tests +
2 real-hardware tests); 11/13 in CI, where the 2 real-hardware tests
skip cleanly (no `IBM_QUANTUM_TOKEN` secret configured there, on
purpose — same reasoning as every other credentialed test in this
project).

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

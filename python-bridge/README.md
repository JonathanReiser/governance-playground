# python-bridge — Tier 2: real IBM quantum hardware

Two independent Tier 2 services, sharing one Flask app and one trust boundary:

- **`instinct_qpu.py`** — companion to `frontend/src/lib/instinct.js`. Tier 1 (already
  shipped — `quantumRng.js`) sources the instinct layer's final collapse from real entropy
  (ANU QRNG / NIST Beacon), but the RY/CX circuit math itself — including the entangling
  gate — is still classical simulation. Tier 2 runs that exact circuit on a real IBM
  quantum processor, so the entanglement itself is physically real, not just correctly
  simulated. Human-reviewable only — does not call `guardianVeto()`/`royalVeto()` on-chain.
- **`layer1_qpu.py`** — higher-stakes: the actual flagship mechanism, not a side veto. Takes
  the exact joint quantum state `agents.js` is tracking for the entangled Iran/Israel pair,
  state-prepares it on real IBM hardware, and measures it — the result IS the committed
  on-chain political collapse when its toggle is on, not a display alongside it. Standalone
  (Saudi) and peacekeeper (US) qubits stay on the classical/Tier-1 path either way.

## Status

**Both verified live against real IBM hardware.** `instinct_qpu.py`, 2026-08-23 — backend
`ibm_marrakesh`, real job ids, not just structurally reviewed. The first live run caught a
real bug: `channel="ibm_quantum"` (what this module was originally written against) has been
fully removed by IBM — migrated to Cloud IAM-based auth, current default is
`"ibm_quantum_platform"`. Fixed, then confirmed: a standalone entangled reading returned a
real job id and outcome, and both deterministic extremes (pressure=0 → ALLOW, pressure=100 →
VETO) came back correct on real hardware with no visible readout error on those shots. See
`instinct_qpu.py`'s module docstring and `tests/test_instinct_qpu.py`'s `TestRealHardwareLive`
for the full detail.

`layer1_qpu.py`, same day — backend `ibm_fez`, real job id, verified two ways: (1)
`TestBitOrdering` prepares concrete asymmetric basis states and a Bell-like correlated state
and confirms the measured outcome labels match, on both simulator and real hardware — not
just derived from the math; (2) a full live UI run — Middle East scenario, all four nations
on Human control, Layer 1 QPU toggle on — committed a cycle where Iran collapsed to HARDLINE
and Israel to HAWKISH off a real hardware measurement, and the entangled-escalation game logic
fired correctly from that result.

24/24 pytest passing locally with a token set (21 simulator-path tests + 3 real-hardware
tests); 21/24 in CI, where the 3 real-hardware tests skip cleanly (no `IBM_QUANTUM_TOKEN`
secret configured there, on purpose — same reasoning as every other credentialed test in
this project).

## Setup

```bash
cd python-bridge
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/python3 -m pytest tests/ -v   # 21 tests, no token needed, no network to IBM's real backend
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

`POST /layer1-collapse` — body `{"joint": [{"re", "im"}, {"re", "im"}, {"re", "im"}, {"re", "im"}]}`,
the exact 4-amplitude joint statevector `agents.js` is currently tracking for the entangled
pair (order `[A0B0, A0B1, A1B0, A1B1]` — see `layer1_qpu.py`'s module docstring for the
bit-ordering mapping to Qiskit's convention). Returns:

```json
{
  "a_outcome": 0 | 1,
  "b_outcome": 0 | 1,
  "backend": "aer_simulator" | "<real IBM backend name>",
  "simulator": true | false,
  "job_id": null | "<real IBM job id>",
  "detail": "<present only on the fallback path>",
  "elapsed_seconds": <present only on the real-hardware path>
}
```

`GET /health` — `{"ok": true, "hasToken": true|false}`.

## Wiring into the rest of the project

`server.js` proxies both `POST /api/instinct/qpu-reading` and `POST /api/layer1/qpu-collapse`
to this service (`http://127.0.0.1:5001` by default, `PYTHON_BRIDGE_URL` to override) — same
pattern as `/api/agent/decide` proxying to Claude. Both are wired all the way into the UI:
`AICycleStep.jsx` has two independent opt-in toggles, one per service, the `layer1-collapse`
one styled as an alert since — unlike the instinct reading, which is human-reviewable only —
its result IS the committed on-chain political outcome when enabled. Both were wired in only
after their real-hardware path had been verified live at least once, not before — wiring an
unverified path into the review UI would be the same mistake this whole project has been
careful to avoid elsewhere: showing something as more real than it's actually been shown to be.

## Running both services together

```bash
# Terminal 1
cd python-bridge && IBM_QUANTUM_TOKEN=... ./venv/bin/python3 app.py

# Terminal 2 (project root)
PYTHON_BRIDGE_URL=http://127.0.0.1:5001 npm run server
```

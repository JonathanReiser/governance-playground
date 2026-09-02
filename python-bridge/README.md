# python-bridge — Tier 2 quantum hardware, plus one theory baseline

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

And one thing that is **not** a Tier 2 service, filed here only because it is quantum game
theory in Python:

- **`ewl_game.py` / `dyad_baseline.py`** — an Eisert-Wilkens-Lewenstein quantum prisoner's
  dilemma, used strictly as a **comparison baseline** for the nation-agent runs. It has no
  hardware path, it is not wired into any commit, and it does not and cannot make the
  simulated nations do anything. See [The EWL baseline](#the-ewl-baseline-theory-not-mechanism)
  below, which spells out that constraint before it says anything else.

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

87/87 pytest passing locally with a token set (84 tests needing no token + 3 real-hardware
tests); 84/87 in CI, where the 3 real-hardware tests skip cleanly (no `IBM_QUANTUM_TOKEN`
secret configured there, on purpose — same reasoning as every other credentialed test in
this project).

The EWL baseline has **no** live-hardware status line here, and that absence is deliberate
rather than a gap — see below for why running it on a QPU would make its numbers worse and
its framing dishonest at the same time.

## Setup

```bash
cd python-bridge
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/python3 -m pytest tests/ -v   # 84 tests, no token needed, no network to IBM's real backend
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

`GET /ewl-baseline` — no body, no run state, no side effects. Returns the three equilibrium
reference points for the scenario's entangled dyad and where the published preregistered
Claude runs actually landed relative to them. The payload's own `label` field carries the
constraint (`"THEORY / COUNTERFACTUAL — not a mechanism acting on any run"`) so that it
survives the response being read on its own, away from this README.

`GET /health` — `{"ok": true, "hasToken": true|false}`.

## The EWL baseline (theory, not mechanism)

**The constraint first, because everything else here depends on it.** EWL requires both
players to apply quantum unitaries to shared entangled qubits. Real nations do not do that.
The Claude-powered nation agents in this project do not do that either — they reason in
natural language over a scenario briefing. So nothing in `ewl_game.py` makes, or could make,
the simulated nations cooperate more. It is a theoretical reference point on the same axis as
their behaviour, and that is its entire role. Reporting EWL as a *cause* of anything observed
in a run of this project would be wrong in exactly the way the sibling repo `quantum-orch-or`
was wrong.

**Why there is no hardware path.** `instinct_qpu.py` and `layer1_qpu.py` measure things whose
value depends on being physically real, and both were verified live before being wired into
anything. The EWL baseline evaluates a closed-form counterfactual instead: its payoffs are
exact statevector algebra, so running them on a noisy QPU would produce a worse estimate of a
number already known exactly, while implying the counterfactual is a measurement of
something. The one thing genuinely worth checking on hardware — that an entangled pair
prepares and jointly measures as derived — `layer1_qpu.py` already checks, live, on `ibm_fez`.

**Three reference points, and why the middle one is the one that matters.** For the
`middle-east-2026` Iran/Israel dyad (`aiAgents.entangled`), with escalate = defect:

| | equilibrium | payoffs |
|---|---|---|
| 1. Classical Nash | `DD` — mutual escalation | (1.00, 1.00) |
| 2. Classical correlated (Aumann 1974) | `DD` — **the polytope is a single point** | (1.00, 1.00) |
| 3. EWL quantum, restricted set | `QQ` | (3.00, 3.00) |

Reference point 2 is the honest bar, because a correlating device is purely classical and in
many games it *already* beats Nash — so "quantum helps" only means something if it beats
that, not Nash. In a strict prisoner's dilemma it turns out to buy nothing at all: a strictly
dominated action gets zero weight in every correlated equilibrium, so the correlated set
collapses onto the Nash point. That is a result in its own right, and it is asserted in
`tests/test_ewl_game.py` rather than asserted in prose.

**Both caveats are computed, not taken on faith.**

- `(Q,Q) -> (3,3)` is a property of these payoffs and of enough entanglement, not a general
  fact. `entanglement_threshold()` scans for where it starts to hold (canonical PD:
  `sin²γ = 2/5`, `γ ≈ 0.685` — substantial but *not* maximal, a sharper claim than "requires
  maximal entanglement"), and `ewl_equilibria()` re-derives the equilibria for whatever payoff
  matrix it is handed. Fed a deadlock game instead, it correctly reports that there is **no**
  pure quantum equilibrium at all.
- Benjamin & Hayden, "Comment on 'Quantum Games and Quantum Strategies'", *Phys. Rev. Lett.*
  **87**, 069801 (2001) argue `(Q,Q)` is an artifact of an arbitrarily restricted strategy
  space. Citation verified against the record, then *reproduced* rather than merely cited:
  `best_response_over_su2()` finds a legitimate SU(2) unitary (`[[0,1],[-1,0]]`, outside EWL's
  set) scoring **5.0** against Q, beating Q's own 3.0. So every quantum equilibrium this code
  reports is labelled an equilibrium **of the restricted game**, and the test suite asserts
  the number that defeats this module's own headline result.

**The payoff matrix is stipulated, not measured.** It is the canonical PD matrix adopted as an
ordinal model of the security dilemma. It is not fitted to the scenario's own metrics, and it
should not be: `stability`/`dealIntegrity`/`proxyActivity` are a 0-100 simulation scale, not
either nation's utility function, and reverse-engineering a utility function from them until a
quantum result appeared is the exact failure this comparison exists to avoid. The matrix is
declared, its PD structure is *verified* (`is_prisoners_dilemma()`), and a caller can replace
it wholesale — every equilibrium is re-derived from whatever is passed in.

**Where the agents actually landed.** Across the published preregistered batches, both
classifiers put the modal cycle at `DD` — the classical Nash point, the dilemma itself —
including in the as-researched baseline arm and in the arm seeded with the single most
favourable lever (`saudi_normalizes_anyway`). Run `./venv/bin/python3 dyad_baseline.py` for
the current table. Two things have to be said alongside that number:

- The agents were never given a quantum strategy set, so this is *not* evidence that
  entanglement would have helped them. It measures where language-model agents reasoning about
  a security dilemma end up, placed next to where three formal models say players end up.
- The primary classifier is **near-degenerate on this dataset**, and the report says so in its
  own output rather than only here. `conflictEvents` is never negative in any published cycle
  for either nation, so there is almost no de-escalatory variation available to detect. The
  right reading is that these particular runs contain one behaviour — not that an equilibrium
  claim has been established. The classifier *can* return "de-escalate":
  `tests/test_dyad_baseline.py` asserts that it does on a de-escalatory input, precisely so
  this caveat is about the data rather than about the code.

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

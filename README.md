# Governance Playground

![Regional stability nearly halved in five cycles. The peace deal's own integrity barely moved.](docs/field-report-preview.png)

**A blockchain-based research sandbox for political science.** Load a real-world geopolitical
scenario, let Claude-powered nation agents reason through it under quantum-modeled
uncertainty, and watch each cycle's metrics get written to a smart contract — tamper-evident,
timestamped, citable by block number. (What that does and does not guarantee is spelled out in
[What the on-chain record actually is](#what-the-on-chain-record-actually-is) — the short version is
that it is narrower than "immutable research".)

**[Read a real, already-verified run →](https://claude.ai/code/artifact/25f0234e-bd9f-4136-98b0-edcc1e8d3700)**
(a 5-cycle simulation, all four nations including the US peacekeeper — real Claude reasoning, real
on-chain transactions, no wallet needed). Everything in it is independently checkable on
[Sepolia Etherscan](https://sepolia.etherscan.io/address/0x863c9db5437AfA4F32d02661ba1EA9752dce592E)
— you don't have to take a live demo's word for it.

**More field reports:**
- **[Taiwan Strait, 10 cycles →](https://claude.ai/code/artifact/1baaa2d4-060d-44ef-b237-fec7769aabb6)** — China, Taiwan, and Japan; stability collapses to zero by cycle 5 and stays there.

**Related project — [civic-lottery-demo](https://github.com/JonathanReiser/civic-lottery-demo):**
the same real-entropy pattern built here for the instinct layer (`quantumRng.js`), applied to a
different problem — provably-fair civic lottery selection (jury pools, housing/visa lotteries)
using pre-commitment + real quantum entropy + a publicly verifiable record. Includes
**[an interactive version](https://claude.ai/code/artifact/f565d166-9b88-4789-ac88-e54daed32a11)**
where you can try to rig the lottery yourself and watch the verification catch you.

**[Or try it live yourself →](https://governance-playground.vercel.app)** — no install needed. The
site also has a **Live Demo** path with no wallet at all (a server-held key pays the gas), if you
just want to watch a real run without any of the setup below.

Connecting your own MetaMask instead works with Sepolia testnet — get free test ETH from a faucet
first: [Google Cloud's Web3 faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)
or [Alchemy's Sepolia faucet](https://www.alchemy.com/faucets/ethereum-sepolia) both work without
needing mainnet ETH elsewhere first. A full deploy is ~10-12 transactions — if a step fails with
`insufficient funds`, that's this, not a bug; get more from the faucet and retry. Note: MetaMask
itself occasionally has extension bugs unrelated to this app — see Troubleshooting below if a
transaction confirmation won't respond.

---

## What this actually is

Most "AI agent simulation" demos are vibes — a model free-associates in character and nothing
is checked. This isn't that. Three constraints keep it honest:

- **Grounded reasoning, not roleplay.** Each nation agent is built on a real IR-theory
  framework — Selectorate Theory (winning-coalition logic), Operational Code (belief system),
  Two-Level Games (domestic constraints on international moves), Prospect Theory (risk posture
  shifts with gains/loss framing) — and every scenario parameter is cited to a real source
  (Freedom House, World Bank, SIPRI, ACLED, Arab Barometer, EIA).
- **Uncertainty is modeled, not faked.** A nation's posture is a quantum probability amplitude,
  not a fixed scalar, until the moment of on-chain commit. Iran and Israel's postures are
  genuinely *entangled* — a structural encoding of the security dilemma — using real complex-
  amplitude math (unitary rotations, Born-rule measurement, interference), not a metaphor layer.
  The actual measurement, at every live commit, is sourced from real quantum entropy (ANU QRNG)
  rather than a PRNG — the same real-entropy pattern the instinct layer already proved out,
  now covering the flagship mechanism itself, not just its side-instinct veto. There's an opt-in
  toggle to go further still: instead of sampling a classically-simulated probability with real
  entropy, the entangled Iran/Israel pair's exact joint quantum state is prepared and *physically
  measured on real IBM quantum hardware* — the collapse that decides the committed political
  outcome is a genuine hardware measurement, not a simulation at all. Verified live: real backend
  (`ibm_fez`), real job id, the entangled-escalation logic firing correctly off that real reading.
- **What is committed can't be quietly edited afterwards.** Each cycle's metrics are written to a
  smart contract; the researcher can revise the *proposed* outcome before committing, but once
  committed it is timestamped and tamper-evident. Note the limit, spelled out below: this protects
  the record of what was published. It does not certify how the numbers were produced.

## What this isn't claiming

Real quantum hardware measuring the collapse is a claim about the *mechanism*: the researcher's
draw is a genuine physical measurement, not dressed-up pseudo-randomness. It is not a claim that
modeling Iran and Israel's postures as entangled makes the simulation predict their actual
real-world relationship any better than a classical, independent model would. That's a different,
harder empirical question — and for this exact dyad, it's already been asked directly with real
data, elsewhere in this same research thread: [quantum-geopolitics-research](https://github.com/JonathanReiser/quantum-geopolitics-research)
tested entanglement against real UN General Assembly voting records (1946–2020) across 10 real
enduring rivalries, Iran-Israel among them. A real correlation showed up (p=1.5×10⁻¹⁷⁰), but it was
fully explained by ordinary bloc-alignment voting — Iran and Israel's sign matched their bloc
exactly, same as all 9 other dyads — not a dyad-specific entangled relationship. Combined with a
null result on real speed-dating data and an invalid-by-design test on real conflict data, that's
three fair, independently-designed tests against real data, zero surviving entanglement. Order/
sequential effects, by contrast, have replicated in every domain they've been tested in, including
this project's own quantum-vs-classical statistical validation (`scripts/quantum-vs-classical-test.mjs`).

**Update, 2026-08-23 — the stronger version of that answer.** All of the above tests share a
weakness: order effects and correlations are compatible with classical psychology too, so they
can't *discriminate* between theories. Quantum-cognition models make exactly one parameter-free
prediction that classical probability doesn't — the **QQ equality** (Wang & Busemeyer 2013), which
held across 70+ national surveys. It has now been tested against 1,006 pairs of real DAO governance
proposals (2.2M dual-voter observations) in
[dao-governance-research](https://github.com/JonathanReiser/dao-governance-research), and **it fails
by a factor of 4–8** — surviving propensity-score weighting and a quasi-experiment where vote order
was fixed by the calendar rather than chosen, and failing in every subsample including votes cast
under a minute apart where no new information could have intervened.

So: the mechanism here is real and physically verified — a genuine measurement on genuine quantum
hardware. But the *empirical* case that human political decisions are quantum-structured has now
been tested five ways against real data and has not survived any of them. This project is best read
as an engineering demonstration of what real quantum measurement in a simulation looks like, not as
evidence that entanglement is the right model of Iran and Israel.

## What the on-chain record actually is

Worth being precise, because "immutable blockchain research" invites a stronger reading than this
project earns.

**What is written.** Five integers per cycle, via `WorldRegistry.commitCycle`: stability index,
conflict events, trade volume, proxy activity, deal integrity.

**What is not written.** The agents' reasoning, the actions they chose, the quantum collapse
outcomes, which IBM backend performed a Tier 2 measurement, and the entire Layer 2/3 economic and
speculative layer. None of it is on-chain. An earlier version of this README claimed "every
decision, every quantum collapse — permanent, citable"; that was false and has been corrected.

**Where it is written.** In Dev Mode, a local Hardhat node that ceases to exist when you stop the
process — no permanence whatsoever. The public deployment is **Sepolia, a testnet**: a genuine
public chain, but one with no economic security behind it, and testnets get retired (Ropsten,
Rinkeby, Kovan and Goerli have all been deprecated). "Permanent" overstates it.

### The limit that actually matters

Immutability gives you **tamper-evidence for what was published**. It does not give you **integrity
of what was computed**. The metrics are calculated off-chain and then written. Nothing here prevents
a researcher running the simulation fifty times and committing only the run they liked — the chain
faithfully records that someone wrote these five numbers at this time, and certifies nothing about
whether they were cherry-picked.

So the honest version of this project's central claim is narrow: *the published record cannot be
silently revised after the fact.* Not: *the findings are trustworthy because they are on a
blockchain.*

### How the spinoff solves this, and why this project can't fully copy it

[civic-lottery-demo](https://github.com/JonathanReiser/civic-lottery-demo) — built out of this
project's real-entropy work — closes exactly this gap, and the mechanism is worth understanding:

1. **Pre-commit the deterministic parameters in public** — who is eligible, how many winners, which
   algorithm, when the draw happens — *before the entropy exists*.
2. **Draw entropy from independent third parties** (ANU's quantum RNG and NIST's public beacon) that
   the operator cannot predict or influence.
3. **Make everything after the seed deterministic**, so any verifier can re-run it and get the same
   answer.

Pre-commitment alone doesn't suffice (you could still pick favourable inputs in advance); external
unpredictable entropy alone doesn't suffice (you could still re-run until you like the result).
Together they close the loop, because at commit time nobody — including the operator — can know
which inputs would even *be* favourable.

**Governance Playground cannot fully replicate step 3.** The simulation has an LLM in the loop, so
it is not deterministically reproducible from a seed: the same configuration and the same entropy
will not reliably regenerate the same run. Cryptographic verifiability of the kind the lottery
achieves is therefore off the table here.

**What is achievable is the pre-registration form of the same idea**, which is weaker but real:
publish the scenario config, the cycle count, the prompts and the model version, and commit in
advance to running once against a future public beacon value and publishing whatever comes back.
That does not make cherry-picking impossible — it makes *non-publication visible*, the same
mechanism that makes clinical-trial pre-registration work. A promised result that never appears is
itself evidence.

**This is now implemented** (`server/prereg.js`, `scripts/prereg.js`, 28 tests in
`test/prereg.test.js`). Three commands for a single preregistered run:

```bash
node scripts/prereg.js register middle-east-2026 --cycles 10 --in 15m   # promise
node scripts/prereg.js draw <hash> --results run.json                   # execute + seal
node scripts/prereg.js verify <hash>                                    # anyone can run this
```

`register` pins the scenario, cycle count, agent model, the doctrine half of every prompt and every
decision schema, then binds them to a NIST beacon pulse identified only by a **future timestamp** —
a pulse that does not exist yet, so nobody, including the operator, can know what it will say or
which parameters would turn out favourable. `draw` refuses to run early, fetches that specific pulse
(`/pulse/time/next/<ms>`, not `/pulse/last`), and hash-chains the run's output to both the promise
and the entropy. Registrations are single-use.

`verify` re-derives all of it from published files plus an independent call to NIST: that the
registration hash recomputes, that the pulse is at or after the registered time, that the result
chains to registration and entropy, that the run used only the registered model, and that NIST
itself still returns the same pulse value. Verified end-to-end against the live beacon on
2026-08-24 (pulse #1916207); editing a single sealed metric afterwards fails the chain check, as
it should. There is deliberately **no PRNG fallback** on the entropy path — unlike the lottery,
where a labeled fallback beats failing a draw, a pre-registration seeded from `Math.random` would
hand the operator control of the one value they promised not to control. If NIST is unreachable,
the correct outcome is that the run does not happen yet.

What it proves: parameters were fixed before the entropy existed, the entropy is genuine and
third-party, and the published result is bound to both. What it does not prove, stated in the
tool's own output so nobody can quote a passing verification as more than it is: that no other runs
were executed. The mechanism makes **non-publication visible** — `verify` on a registration with no
result reports that as the finding rather than as an error, and `list` flags overdue registrations
as `UNPUBLISHED`. A promised result that never appears is evidence.

**Batch mode — N independent trials, for a distribution instead of one run's single outcome.** A
single preregistered run above still can't tell a real effect from ordinary stochasticity (real LLM
sampling, real quantum collapse). Three parallel commands run and preregister a whole batch at once:

```bash
node scripts/prereg.js register-batch middle-east-2026 --trials 50 --cycles 5 \
    --hypothesis "Blocking sanctions relief lowers median regional stability" \
    --conditions congress_blocks_relief --in 15m
node scripts/prereg.js draw-batch <hash> --results batch.json    # every trial, sealed together
node scripts/prereg.js verify-batch <hash>
```

Same NIST-pulse binding as the single-run path, plus one check specific to a batch: the published
trial count must match what was registered, so a batch can't quietly shrink to just the trials that
looked favorable after the fact — `verify-batch` fails outright if even one registered trial is
missing. Verified end-to-end against the live beacon on 2026-08-27. Deliberately not on-chain: each
trial already gets its own genuine quantum entropy per cycle exactly as any other run does, so a
batch's actual exposure is publishing only its best-looking trials, not entropy prediction — closing
that gap needs the same "commit before you can see results" trick this file already used for one
run, not a second, gas-costing trust mechanism running in parallel.

The sibling project
[dao-governance-research](https://github.com/JonathanReiser/dao-governance-research) already applies
the discipline in its plainest form — every design decision committed to git before the
corresponding result was computed.

## The agent layer's model, and why it is pinned

The nation agents reason from four IR-theory frameworks simultaneously
(Selectorate, Operational Code, Two-Level Games, Prospect Theory) and have to
respect hard per-nation constraints — Iran cannot `EXIT_DEAL` unless deal
integrity is under 30 or hardliner pressure is over 88, and so on. That is a
real reasoning task, so it runs on **`claude-opus-5` with adaptive thinking**,
set in one place (`AGENT_MODEL` in `server.js`).

It did not always. Through 2026-08-24 this layer ran on `claude-haiku-4-5`, with
the endpoint repairing the model's JSON in string-land afterwards — stripping
markdown fences and rewriting `+5` into `5` because the smaller model emitted
invalid JSON. Both workarounds are gone: the decision contract is now enforced
by the API through per-nation JSON schemas (`DECISION_SCHEMAS`), one per nation,
matching exactly the `## Output Format` block that nation's own prompt declares.
`assertSchemasMatchPrompts()` runs at boot and warns if a prompt and its schema
ever drift apart. Typing `metricDeltas` as integers is what makes the `+5` case
impossible rather than patched.

**This is a change of research substrate, not just a quality upgrade.** Any run
produced before that date came from a different model, and results are not
comparable across the boundary. That is precisely the thing the pre-registration
item above exists to make legible: a published run has to name its model version,
because "the simulation said X" is not a claim until you can say what was doing
the simulating.

The prompts were restructured at the same time so that doctrine (frameworks,
operational code, thresholds, output contract — byte-identical every cycle and
every run) sits above the `## Current World State` heading and live state sits
below it. Both halves go to the model as before; the split exists so the doctrine
half can be a cache prefix, and so the publishable part of a prompt is separable
from the per-cycle part. Measured effect: 1,380–1,834 tokens per nation served
from cache from the second cycle of a run onward, roughly 55–60% of each
request's input.

## Architecture

```
Political layer (Layer 1)     Nation agents (Claude) reason each cycle; Iran/Israel entangled,
                               Saudi Arabia standalone. Collapses at commit — Tier 1 (default):
                               Born-rule measurement, real-entropy-sourced (ANU QRNG). Tier 2
                               (opt-in toggle, alert-styled — this feeds the committed outcome):
                               the entangled pair's exact joint state prepared and measured on
                               real IBM quantum hardware, `python-bridge/layer1_qpu.py`; the
                               standalone (Saudi) and peacekeeper (US) qubits stay on Tier 1.
                               Verified live: real backend (`ibm_fez`), real job id, entangled-
                               escalation firing correctly off the real measurement.
        │
        ▼
Economic field (Layer 2)      Oil / Iranian rial / Saudi riyal / US gas price as one 4-qubit
                               entangled register — a real oil shock stresses Iran's currency
                               while filling Saudi coffers, and vice versa.
        │
        ▼
Speculation (Layer 3)         Six synthetic trader archetypes react to the collapsed fundamental;
                               their reactions interfere (complex amplitudes, not averaged) —
                               that's where the fat-tailed price moves come from.
        │
        ▼
On-chain record                WorldRegistry + MetricsOracle (Solidity). Five integers per cycle:
                               stability index, conflict events, trade volume, proxy activity, deal
                               integrity. Agent reasoning, chosen actions, quantum collapse outcomes
                               and the market layer are NOT written on-chain.

Retrograde feedback (2/3 → 1)  Middle East only, for now: next cycle, last cycle's collapsed
                               economic/speculative outcome rotates the political qubits back —
                               a weakening rial hardens Iran, a riyal windfall eases Saudi reform
                               pressure, a gas-price surge nudges the US peacekeeper toward
                               disengagement — amplified by Layer 3's tail risk. One cycle in
                               arrears, so causality within a single cycle stays one-directional.
        │
        ▼
Instinct layer (upstream of   The pre-deliberative guardian/royal veto — NationDAO.sol's one
Layer 1, not part of it)      "single actor, gut call" mechanism, distinct from castVote()'s
                               tallied plurality. Tier 1 (`instinct.js`): a real quantum-circuit
                               simulation (RY/CX gates), sampled with real entropy from the ANU
                               Quantum RNG (a physical laser vacuum-fluctuation measurement, PRNG
                               fallback if unreachable, always labeled). Tier 2 (`python-bridge/`,
                               opt-in toggle in the AI Agent Cycle UI): the SAME circuit, run for
                               real on IBM quantum hardware — genuinely collapsed, not simulated-
                               then-sampled. Verified live: real backend (`ibm_marrakesh`), real
                               job ids, both Iran's and Saudi Arabia's readings independently
                               confirmed correct. Human-reviewable only — does not call
                               `guardianVeto()`/`royalVeto()` on-chain, does not feed simState.
```

Smart contracts in Solidity (Hardhat), frontend in React, the agent layer talks to Claude via a
small Express server, and the quantum engine (`frontend/src/lib/quantum.js`) is a from-scratch
complex-amplitude implementation — no framework, no shortcuts.

## Status

| Piece | Status |
|---|---|
| Smart contracts + test suite (83/83) | ✅ Done, runs in CI (`.github/workflows/contracts-tests.yml`) |
| Classic (fixed-rule) experiments, 4 pre-built scenarios | ✅ Done |
| AI agent layer (Claude-driven nation decisions) | ✅ Done, verified live — `claude-opus-5`, adaptive thinking, structured outputs (see below) |
| Quantum extension — entangled political layer | ✅ Done, verified live |
| Quantum extension — economic field + speculation (Layer 2/3) | ✅ Done, verified live |
| Retrograde feedback, Layer 2/3 → Layer 1 (Middle East only) | ✅ Done |
| AI/Quantum-mode results view | ✅ Done, verified live |
| Instinct layer, Tier 1 (real ANU QRNG entropy) | ✅ Done, wired into the review UI, verified live |
| Instinct layer, Tier 2 (real IBM quantum hardware) | ✅ Done — opt-in toggle, verified live end-to-end on real hardware (`ibm_marrakesh`), see `python-bridge/README.md` |
| Political layer (Layer 1) + economic field (Layer 2/3), real entropy (Tier 1) | ✅ Done — the actual flagship collapse (not just the instinct veto's) now sources from real ANU QRNG at every live commit, verified live. `scripts/quantum-vs-classical-test.mjs`'s shared default is untouched on purpose (still `Math.random`, thousands of trials per validation run) |
| Pre-registration (publish parameters, bind to a future NIST pulse, publish whatever comes back) | ✅ Done — `scripts/prereg.js`, verified end-to-end against the live beacon |
| Batch pre-registration (N independent trials, one hypothesis, published trial count enforced) | ✅ Done — `scripts/prereg.js register-batch`/`draw-batch`/`verify-batch`, verified end-to-end against the live beacon |
| Political layer (Layer 1), real IBM quantum hardware (Tier 2) | ✅ Done — opt-in toggle, scoped to the entangled Iran/Israel pair only (standalone/peacekeeper stay Tier 1). Verified live end-to-end: real backend (`ibm_fez`), real job id, feeds the actual committed on-chain outcome, not a side display |
| Grant application (Ethereum Foundation small grants) | ✅ Ready — see `GRANT_APPLICATION.md` |
| Live news grounding | ⬜ Currently mock headlines |
| More scenarios (Palestine, Taiwan Strait, Russia-Ukraine, …) | ⬜ Planned |
| Sepolia testnet deployment | ✅ Live — [verified on Etherscan](https://sepolia.etherscan.io/address/0x863c9db5437AfA4F32d02661ba1EA9752dce592E) |
| Hosted/always-on version | ✅ Live at [governance-playground.vercel.app](https://governance-playground.vercel.app) |

## Running it locally

You'll need three terminals.

```bash
# Terminal 1 — local blockchain
git clone https://github.com/JonathanReiser/governance-playground.git
cd governance-playground
npm install
npx hardhat node
```

```bash
# Terminal 2 — deploy the scenario, then the AI agent server
npx hardhat run scripts/deploy.js --network localhost
ANTHROPIC_API_KEY=sk-ant-... npm run server
```

```bash
# Terminal 3 — frontend
cd frontend
npm install
npm run dev
# → http://localhost:5173 — click "Dev Mode" to skip MetaMask
```

Walk through: **Connect → Scenario → Deploy → choose "AI Agent Cycle" → Run → Results.**

**Optional — Tier 2, real IBM quantum hardware:** a 4th terminal, only needed if you want either
of the two "Use real IBM quantum hardware" toggles on the AI Agent Cycle screen (instinct readings,
and — alert-styled, since it feeds the committed on-chain outcome — the political collapse itself)
to reach real hardware instead of falling back to a local reading:

```bash
cd python-bridge
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
IBM_QUANTUM_TOKEN=your-token-from-quantum.ibm.com ./venv/bin/python3 app.py
```

Never paste a real token into a chat session — set it directly in your own shell/`.env`. See
`python-bridge/README.md` for the full setup, current verified-live status, and what "real" means
here (an actual physical qubit measurement, not `instinct.js`'s own simulated-circuit-plus-real-
entropy-sample — see that file's own "ON GENUINE INDETERMINACY" note for the precise distinction).

### Running the tests

Three separate suites, all running in CI on every push/PR to `main`:

```bash
npm test                   # 83-test Solidity/Chai suite — contracts/ (.github/workflows/contracts-tests.yml)
cd frontend && npm test    # vitest — the quantum-engine plumbing (agents.js/markets.js) (.github/workflows/frontend-tests.yml)
cd python-bridge && ./venv/bin/python3 -m pytest tests/ -v   # instinct_qpu.py + layer1_qpu.py — no token needed; the 3 real-hardware tests skip cleanly without one
```

### Troubleshooting: MetaMask stuck on "Review alert"

MetaMask runs every transaction through a third-party security scanner before letting you confirm
it. Occasionally that scanner's alert fails to load its own content, leaving you with a
**grayed-out, unclickable "Review alert" button and no visible warning text** — a MetaMask bug,
not anything wrong with this app or its contracts. If you hit this:

- Turn off MetaMask's security-alert scanning: **Settings → Transactions** (not Security &
  Privacy — it moved there in newer versions) → disable the security-alerts toggle.
- Check for a pending MetaMask extension update (`chrome://extensions` → MetaMask → reload icon).
- Temporarily disable other extensions (ad blockers, VPNs, other wallets) that might be blocking
  the network call MetaMask makes to fetch the alert's content.
- If you run a DNS-level blocker (Pi-hole, NextDNS, a VPN with ad-blocking) try disabling it —
  it can silently block MetaMask's alert-provider API.
- Reload the extension itself (`chrome://extensions` → MetaMask → reload icon) or lock/unlock it
  (account icon → Lock, then unlock) to reset its internal state.
- As a fallback, **[read a real, already-verified run instead](https://claude.ai/code/artifact/25f0234e-bd9f-4136-98b0-edcc1e8d3700)**
  — a live 5-cycle simulation with real on-chain tx hashes, no wallet required.

## Project structure

```
contracts/          Solidity — WorldRegistry, NationDAO, CitizenToken, MetricsOracle
scenarios/           Scenario configs (nations, relationships, starting metrics, cited sources)
scripts/             Deploy + experiment runners
server.js            Express server proxying Claude API calls for the agent layer
                     (AGENT_MODEL + DECISION_SCHEMAS + splitPrompt live here)
frontend/
  src/lib/           quantum.js (engine), markets.js (Layer 2/3), agents.js (Layer 1 + Claude)
  src/components/    Step-by-step UI: Connect → Scenario → Deploy → Run → Results
test/                83-test Hardhat/Chai suite
```

## Why blockchain

A lab notebook whose committed pages can't be rewritten afterwards. Once a cycle's metrics are
committed they are timestamped and tamper-evident, and the scenario parameters are public before
the experiment runs.

What this does **not** give you: the researcher can still choose *which* run to commit. Immutability
protects the record of what was published; it says nothing about whether what was published was
selected. An earlier version of this section claimed "nobody — not even the researcher — can alter
results after the fact," which overstated it — cherry-picking a favourable run is exactly a way of
altering results that immutability does not prevent.

See [What the on-chain record actually is](#what-the-on-chain-record-actually-is) for the full
accounting, and for how the [civic-lottery-demo](https://github.com/JonathanReiser/civic-lottery-demo)
spinoff closes this gap with pre-commitment — plus why an LLM in the loop stops this project from
copying that approach wholesale.

## Research background

Built by someone with a philosophy + software consulting background, interested in whether IR
theories are actually predictive — the falsifiability angle. Solo project; collaborators welcome.

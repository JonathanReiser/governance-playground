# Governance Playground

![Regional stability nearly halved in five cycles. The peace deal's own integrity barely moved.](docs/field-report-preview.png)

**A blockchain-based research sandbox for political science.** Load a real-world geopolitical
scenario, let Claude-powered nation agents reason through it under quantum-modeled
uncertainty, and watch the result get written — immutably, cycle by cycle — to a blockchain.
Every finding is citable by block number.

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

**[Or try it live yourself →](https://governance-playground.vercel.app)** — no install needed.
Connect via MetaMask (works with Sepolia testnet — get free test ETH from a faucet, see Quickstart
below). Note: MetaMask itself occasionally has extension bugs unrelated to this app — see
Troubleshooting below if a transaction confirmation won't respond.

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
- **Nothing can be edited after the fact.** Every cycle's outcome is written to a smart contract.
  The researcher can review and edit the *proposed* outcome before committing — but once
  committed, it's on-chain, timestamped, and permanent. Parameters are always public before the
  experiment runs.

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
On-chain record                WorldRegistry + MetricsOracle (Solidity). Every cycle's metrics,
                               every decision, every quantum collapse — permanent, citable.

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
| AI agent layer (Claude-driven nation decisions) | ✅ Done, verified live |
| Quantum extension — entangled political layer | ✅ Done, verified live |
| Quantum extension — economic field + speculation (Layer 2/3) | ✅ Done, verified live |
| Retrograde feedback, Layer 2/3 → Layer 1 (Middle East only) | ✅ Done |
| AI/Quantum-mode results view | ✅ Done, verified live |
| Instinct layer, Tier 1 (real ANU QRNG entropy) | ✅ Done, wired into the review UI, verified live |
| Instinct layer, Tier 2 (real IBM quantum hardware) | ✅ Done — opt-in toggle, verified live end-to-end on real hardware (`ibm_marrakesh`), see `python-bridge/README.md` |
| Political layer (Layer 1) + economic field (Layer 2/3), real entropy (Tier 1) | ✅ Done — the actual flagship collapse (not just the instinct veto's) now sources from real ANU QRNG at every live commit, verified live. `scripts/quantum-vs-classical-test.mjs`'s shared default is untouched on purpose (still `Math.random`, thousands of trials per validation run) |
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
frontend/
  src/lib/           quantum.js (engine), markets.js (Layer 2/3), agents.js (Layer 1 + Claude)
  src/components/    Step-by-step UI: Connect → Scenario → Deploy → Run → Results
test/                83-test Hardhat/Chai suite
```

## Why blockchain

Immutability makes findings credible. Nobody — not even the researcher — can alter results
after the fact, and every parameter is public before the experiment runs. That's the whole
pitch: this is a lab notebook that can't be edited retroactively.

## Research background

Built by someone with a philosophy + software consulting background, interested in whether IR
theories are actually predictive — the falsifiability angle. Solo project; collaborators welcome.

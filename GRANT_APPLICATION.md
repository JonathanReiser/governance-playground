# Ethereum Foundation Small Grants Application
## Governance Playground — A Transparent Political Science Lab on Ethereum

---

## Project Summary

Governance Playground is an open-source research sandbox where political scientists, students, and policy researchers can model governance systems, load real-world geopolitical scenarios, run controlled "what if" experiments, and measure outcomes — with each cycle's metrics recorded on-chain — tamper-evident, timestamped, and citable by block number. (Scope note: five metric integers per cycle are written; agent reasoning, chosen actions and quantum collapse outcomes are not. The deployment target is the Sepolia testnet.)

**Live demo:** https://governance-playground.vercel.app — no install required.
**Code:** https://github.com/JonathanReiser/governance-playground (public, ISC-licensed)
**On-chain, independently verifiable:** [WorldRegistry on Sepolia Etherscan](https://sepolia.etherscan.io/address/0x863c9db5437AfA4F32d02661ba1EA9752dce592E)

The first scenario: **The Middle East, May 2026** — a fragile post-war environment following the US/Israel-Iran peace deal. It now runs in two modes. Four fixed-rule experiments are already running:

| Experiment | Stability Outcome | Key Finding |
|---|---|---|
| Peace deal collapses | 0/100 (Critical) | Non-linear catastrophic collapse, no recovery |
| US blocks sanctions relief | 20/100 (Critical) | Deal survives but barely; proxy activity triples |
| Saudi Arabia normalizes | 60/100 (Moderate) | Only scenario where stability improves |
| Hardliners gain power | 0/100 (Critical) | Identical outcome to deal collapse — different cause, same endpoint |

80 simulation cycles are on-chain. The findings are citable. The code is reproducible.

Alongside those fixed-rule experiments, a second mode is now live: three Claude-powered nation
agents — grounded in real IR-theory frameworks (Selectorate Theory, Operational Code, Two-Level
Games, Prospect Theory) — reason through the same scenario cycle by cycle, under genuinely
quantum-modeled uncertainty (not a metaphor: a from-scratch complex-amplitude engine implementing
unitary rotation, Born-rule measurement, and interference). See "The Agent Layer" below.

---

## The Problem

Political scientists face an impossible constraint: you cannot test what causes war by starting one. You cannot test what makes peace deals hold by collapsing them.

Existing simulation tools have three failure modes:

1. **Opacity** — Simulations run on proprietary software or personal machines. Researchers must trust the builder's parameters and algorithms. Nobody can verify the model.

2. **Non-reproducibility** — There is no shared, canonical record of what parameters were used or what results were produced. Two researchers running "the same" simulation on different tools get different results with no audit trail.

3. **The manipulation problem** — If a think tank funds a simulation, there is no mechanism to prove the researcher didn't adjust parameters after seeing results they didn't like.

Blockchain solves all three. When a simulation runs on Ethereum:
- Every parameter is public before the experiment begins
- Every committed cycle's metrics are timestamped and tamper-evident on-chain
- Nobody — not even the researcher — can alter the record
- Any finding can be independently reproduced by anyone with the code

This is the difference between a demo and a **credible research instrument**.

---

## What We've Built

### Smart Contracts (Hardhat / Solidity)

Four contracts form the core system:

**`CitizenToken.sol`** — ERC-20 citizenship tokens representing voting power within a nation. Supports delegation. Each nation has its own token with configurable supply distribution.

**`NationDAO.sol`** — The governance engine for a single nation. Parameterized to reflect real governance structures:
- Israel → Parliamentary Democracy (low threshold, coalition required)
- Iran → Theocratic Republic (Guardian Council veto, dual-layer voting)
- Saudi Arabia → Absolute Monarchy (royal veto, council-only proposals)

Full proposal lifecycle: Propose → Vote → Queue → Execute. All on-chain.

**`WorldRegistry.sol`** — The simulation controller. Deploys and tracks all nations, manages inter-nation relationships (Allied → Hostile on a 7-point scale), applies experiment changes, advances simulation cycles.

**`MetricsOracle.sol`** — The measurement engine. Records stability index, conflict events, trade volume, proxy activity, and deal integrity every cycle. Compares experiment outcomes against baseline. Detects anomalies (sudden stability drops). These five metrics per cycle are what is written on-chain.

### Scenario Config

**`middle-east-2026.config.cjs`** — A fully cited scenario file representing the geopolitical state of the Middle East as of May 2026. Every parameter traces to a named source:
- Freedom House 2026 (governance scores)
- World Bank 2026 (economic data)
- SIPRI 2026 (military expenditure)
- ACLED 2026 (conflict event data)
- Arab Barometer Wave VII (public sentiment)
- EIA 2026 (energy/oil data)

If a researcher disagrees with a parameter, they fork the file, change it, and run their own experiment. The divergence is itself a research contribution.

### Experiment Runner

`run-all-experiments.js` deploys the full scenario, runs a 10-cycle baseline (control group), applies one variable change, runs a second 10-cycle simulation, and produces a structured research report with hypothesis evaluation. Each run writes 20 cycles to the blockchain. The script is fully automated — one command produces a citable research output.

### Test Suite

83 unit and integration tests covering every critical contract behavior: citizenship minting and delegation, proposal lifecycle, veto mechanisms, relationship management, metric recording, baseline comparison, anomaly detection, the combined single-transaction cycle commit, and the full integrated scenario.

---

## Research Findings (Produced by the System)

The four experiments above were not hand-crafted results — they are the output of running `run-all-experiments.js` against the deployed contracts. The findings surprised us:

**Finding 1 — Non-linearity of collapse.** When the peace deal collapses, regional stability reaches 0/100 within 4 cycles. There is no recovery mechanism. The deterioration is not gradual — it is a threshold event.

**Finding 2 — Hardliner victory = deal collapse, different path.** The "Iranian Hardliners Gain Power" experiment produces identical terminal values to "The Deal Collapses" (stability: 0, trade: 0, proxy: 100). This suggests hardliner victory is not a distinct trajectory — it is a delayed deal collapse. The policy implication: preventing hardliner consolidation and preventing deal collapse are equivalent interventions.

**Finding 3 — Saudi normalization is net positive with a security cost.** The only experiment that improves stability also produces the second-highest proxy activity response from Iran. Economic integration and security escalation move together. A "Saudi normalization" policy cannot be evaluated on trade metrics alone.

**Finding 4 — The deal is more fragile than it appears.** In the baseline (no experiment), deal integrity decays at 2 points per cycle from a starting value of 32. At that rate, the deal collapses on its own by cycle 16 without intervention. The experiments accelerate a process that is already happening.

The metrics behind these findings are recorded on-chain and cite a block. The reasoning and decisions behind them are not on-chain — they live in the run logs and artifacts.

---

## Why Blockchain, Specifically

The research value of this tool depends entirely on the trustworthiness of the record. A simulation that runs on a laptop proves nothing — the researcher could have run it 50 times and published the result that confirmed their hypothesis.

When the simulation runs on Ethereum:
- Parameters are committed before execution begins
- Results cannot be selectively disclosed
- Any researcher anywhere can reproduce the exact run
- The timestamp proves when the experiment was conducted relative to real-world events

This is not blockchain-for-blockchain's-sake: the specific property being used is that a committed record cannot be silently revised afterwards.

But that property is narrower than it first appears, and this document should say so. Immutability protects the record of what was *published*; it does not certify how the numbers were *produced*. A researcher can still run a simulation repeatedly and commit only the run they prefer. Making that harder requires pre-commitment — publishing the configuration and committing in advance to report a single run against a future public beacon value — which is implemented in the sibling project civic-lottery-demo but not here, because an LLM in the loop makes the run non-reproducible from a seed. Treat the on-chain record as tamper-evidence for what was reported, not as a guarantee that it was not selected.

---

## The Bigger Vision

The Middle East scenario is the first application of a modular governance primitive set. The same contracts — CitizenToken, NationDAO, WorldRegistry, MetricsOracle — can model:

- European Union legislative dynamics
- City council decision-making
- Worker cooperative governance
- Online community moderation structures
- Any social system with collective decision-making

Each "scenario" is a config file. New scenarios require no new contracts.

### The Agent Layer (Built)

The rules-based simulation above was the starting point. It's since been extended with a live
AI agent layer and a genuine quantum-cognition model of uncertainty — not a roadmap item, a
working system, verified end-to-end against real on-chain transactions.

**AI Agents** — Each nation is a Claude-powered agent grounded in a specific IR-theory framework,
not generic roleplay: Iran runs on Selectorate Theory (a small winning coalition — Supreme Leader,
IRGC, Guardian Council) and a zero-sum Operational Code; Israel runs on the Begin Doctrine and
Two-Level Games (domestic coalition math constrains international moves); Saudi Arabia runs on
loss-averse Prospect Theory and hedges rather than commits. Every cycle, all three reason
independently over the current world state and commit a decision.

**Quantum-modeled uncertainty** — A nation's posture is a probability amplitude, not a fixed
scalar, until the moment of on-chain commit. Iran and Israel's postures are genuinely *entangled*
— a structural encoding of the security dilemma, where neither side's stance is fully separable
from the other's — using real complex-amplitude math (unitary rotation, Born-rule measurement,
interference), built from scratch, not a third-party quantum computing SDK bolted on for effect.
The same engine models a 4-instrument entangled economic field (oil, the Iranian rial, the Saudi
riyal, US gas prices) and a synthetic-trader speculation layer where fat-tailed price moves emerge
from interference structure rather than a bolted-on distribution choice.

This isn't a metaphor borrowed from physics for flavor — it follows an established research
program. Quantum probability theory has been used for two decades to model human judgment because
classical (Kolmogorov) probability provably cannot reproduce well-documented decision phenomena:
order effects, where asking about Actor A before Actor B yields a different joint judgment than
the reverse order (Pothos & Busemeyer, *"A quantum probability explanation for violations of
rational decision theory,"* Proc. Royal Society B, 2009 — a study specifically about sequential
geopolitical-style judgments); and the disjunction effect, where a decision made under known
outcome A and known outcome not-A differs from the same decision made under genuine uncertainty
between them, violating Savage's sure-thing principle (Busemeyer & Bruza, *Quantum Models of
Cognition and Decision*, Cambridge University Press, 2012). This simulation's order-dependent
cycle evolution (Iran → Israel → Saudi Arabia, not commutative) and its entangled-collapse
"escalation" effect are direct implementations of exactly these two phenomena, not loose analogies
to them.

This grounding makes the model's central claim falsifiable, not just evocative: if the entangled
formalism is doing real work, a scenario run through it should predict a specific non-additive
interaction — P(Iran hardline ∧ Israel hawkish) measurably diverging from
P(Iran hardline) × P(Israel hawkish) — that a classical baseline run of the identical scenario
config cannot reproduce. That comparison (quantum vs. classical model fit against the same
decision data, scored via a chi-square independence test, in the spirit of the quantum-vs-classical
model-fit method in Busemeyer, Wang & Townsend, *"Quantum dynamics of human decision-making,"*
Journal of Mathematical Psychology, 2006) has now been run — see below.

**The falsifiable claim, tested on real logged decisions** — `scripts/quantum-vs-classical-test.mjs`
runs this comparison directly: the SAME real per-cycle Claude decisions are fed into the production
entangled model and into a classical control with A's and B's inputs drawn from independent rows
(isolating the entanglement contribution specifically, not just any correlation). On 42 real logged
cycles across 7 independent Dev Mode runs (bootstrap-resampled to 5,000 trials): the entangled arm
shows a large, significant joint-outcome correlation (chi-square(1) = 1536.55, p < 0.0001) that the
properly decorrelated classical control does not (chi-square(1) = 0.10, p = 0.75). An earlier,
naive classical control (sharing the same resampled row between A and B) looked deceptively
significant once the pool grew past 10 cycles — caught and fixed by isolating a genuinely
independent control, documented in the script itself. This is one evidentiary batch, not a settled
finding — it demonstrates the mechanism produces its predicted statistical signature under a
methodology built to catch its own false positives, not merely that it runs without error.

**Replicated on a second, independently-built scenario** — the same test run against 29 real logged
cycles across 5 Dev Mode runs of the Taiwan Strait scenario (a separately-designed China/Taiwan
entangled pair, different driver fields, different economic instruments — not a copy-paste of the
Middle East config) shows the identical qualitative signature: entangled arm chi-square(1) = 1605.38,
p < 0.0001, vs. the decorrelated classical control at chi-square(1) = 0.60, p = 0.44. This is
stronger evidence than either result alone — it shows the mechanism produces its predicted
statistical signature generally, not as an artifact specific to one dyad's particular math.

**Verified, not just built** — A real run: Iran, Israel, and Saudi Arabia's quantum states
collapsed into a mutually-reinforcing hardline/hawkish configuration two cycles running, triggering
the model's predicted "entangled escalation" effect both times; Iran's agent independently chose to
exit the peace deal entirely (`EXIT_DEAL`, threatening Hormuz, partial nuclear breakout) as
hardliner pressure and collapsing deal integrity converged — regional stability fell from 48/100 to
13/100 in two cycles. Every metric change, every quantum collapse, and every agent decision was a
real, mined transaction — [full methodology and code](https://github.com/JonathanReiser/governance-playground).
The contracts themselves are separately [verified live on Sepolia](https://sepolia.etherscan.io/address/0x863c9db5437AfA4F32d02661ba1EA9752dce592E).

**Human Agents (still the natural next step)** — Researchers, students, and participants holding
citizenship tokens and voting on proposals directly, playing the same roles the AI agents currently
play. The blockchain doesn't care whether a decision came from a human or an AI — it enforces the
rules and records everything either way. Human-in-the-loop validation is the piece that would let
the AI-agent findings above be checked against expert political-scientist judgment at scale.

---

## Requested Funding

**Amount:** $10,000–15,000 USD (or ETH equivalent)

**Use:** The AI agent layer, quantum uncertainty model, frontend, and Sepolia deployment above were
built without grant funding — this ask is scoped to what's genuinely still needed, not what's
already done.

| Item | Allocation |
|---|---|
| Sustained Claude API costs — running the public demo and continued experiment cycles at scale isn't free per-call, and this is the resource that's actually consumed by usage | 25% |
| Additional scenarios — EU governance, additional Middle East nations (Palestine, Lebanon, Turkey, UAE), Taiwan Strait, Russia-Ukraine | 30% |
| Live news grounding (real NewsAPI/GDELT integration, currently mock headlines) and Layer 2→1 feedback (economic distress currently doesn't loop back into nation decisions) | 20% |
| Mainnet migration path — gas cost analysis, contract security review, the step from "verifiable on a testnet" to "verifiable on the network researchers would actually cite" | 15% |
| Documentation, academic write-up of the quantum-cognition approach, researcher onboarding materials | 10% |

---

## Grant Ecosystem Fit

This project sits at the intersection of three grant-funding communities:

- **Web3 / Ethereum** — transparent governance tooling, public goods research infrastructure
- **Academic** — NSF, SSRC, USIP fund conflict resolution and political science research
- **Policy** — Brookings, Crisis Group, Carnegie fund Middle East and governance research

The Ethereum Foundation small grants program is the right first stop because the core technical contribution is the on-chain simulation primitive — the claim that blockchain is the correct substrate for credible political science research. Validating that claim requires an Ethereum grant, not an academic one.

---

## Team

Solo researcher and developer. Background spans geopolitical analysis and smart contract development — the specific combination required to build this.

The prototype exists because this project required two skills that almost never overlap. The tooling to build it has only matured in the last few years. There is no obvious commercial product here, which is why it doesn't exist yet and why grants exist.

---

## Repository

All code is open source at **https://github.com/JonathanReiser/governance-playground** — contracts,
scenario config, experiment runner, quantum engine, AI agent layer, frontend, and test suite in a
single repository.

**Live demo:** https://governance-playground.vercel.app (no install required)
**Test status:** 83/83 passing
**Lines of Solidity:** ~900 (across WorldRegistry, NationDAO, CitizenToken, MetricsOracle, and two
factory contracts split out to stay under Ethereum's 24KB contract-size limit — a real constraint
hit and fixed during the Sepolia deployment, not a theoretical one)
**Experiments run:** 4 fixed-rule (80 blockchain cycles recorded) + AI-agent runs verified live on
Sepolia
**Reproducibility:** Any researcher can clone the repo, run `npx hardhat run scripts/run-all-experiments.js`
for the fixed-rule experiments, or follow the README's quickstart for the AI/quantum mode, and
reproduce every finding in this application — or open the live demo and run their own.

---

## One-Sentence Version

A transparent, tamper-proof political science lab where researchers run controlled experiments on real-world governance scenarios — starting with the Middle East — and measure what actually leads to stability.

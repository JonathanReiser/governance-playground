# Ethereum Foundation Small Grants Application
## Governance Playground — A Transparent Political Science Lab on Ethereum

---

## Project Summary

Governance Playground is an open-source research sandbox where political scientists, students, and policy researchers can model governance systems, load real-world geopolitical scenarios, run controlled "what if" experiments, and measure outcomes — all recorded on-chain. Every finding is permanently verifiable, reproducible, and citable by block number.

The first scenario: **The Middle East, May 2026** — a fragile post-war environment following the US/Israel-Iran peace deal. Four experiments are already running:

| Experiment | Stability Outcome | Key Finding |
|---|---|---|
| Peace deal collapses | 0/100 (Critical) | Non-linear catastrophic collapse, no recovery |
| US blocks sanctions relief | 20/100 (Critical) | Deal survives but barely; proxy activity triples |
| Saudi Arabia normalizes | 60/100 (Moderate) | Only scenario where stability improves |
| Hardliners gain power | 0/100 (Critical) | Identical outcome to deal collapse — different cause, same endpoint |

80 simulation cycles are on-chain. The findings are citable. The code is reproducible.

---

## The Problem

Political scientists face an impossible constraint: you cannot test what causes war by starting one. You cannot test what makes peace deals hold by collapsing them.

Existing simulation tools have three failure modes:

1. **Opacity** — Simulations run on proprietary software or personal machines. Researchers must trust the builder's parameters and algorithms. Nobody can verify the model.

2. **Non-reproducibility** — There is no shared, canonical record of what parameters were used or what results were produced. Two researchers running "the same" simulation on different tools get different results with no audit trail.

3. **The manipulation problem** — If a think tank funds a simulation, there is no mechanism to prove the researcher didn't adjust parameters after seeing results they didn't like.

Blockchain solves all three. When a simulation runs on Ethereum:
- Every parameter is public before the experiment begins
- Every result is permanently recorded and timestamped
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

**`MetricsOracle.sol`** — The measurement engine. Records stability index, conflict events, trade volume, proxy activity, and deal integrity every cycle. Compares experiment outcomes against baseline. Detects anomalies (sudden stability drops). All permanently on-chain.

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

76 unit and integration tests covering every critical contract behavior: citizenship minting and delegation, proposal lifecycle, veto mechanisms, relationship management, metric recording, baseline comparison, anomaly detection, and the full integrated scenario.

---

## Research Findings (Produced by the System)

The four experiments above were not hand-crafted results — they are the output of running `run-all-experiments.js` against the deployed contracts. The findings surprised us:

**Finding 1 — Non-linearity of collapse.** When the peace deal collapses, regional stability reaches 0/100 within 4 cycles. There is no recovery mechanism. The deterioration is not gradual — it is a threshold event.

**Finding 2 — Hardliner victory = deal collapse, different path.** The "Iranian Hardliners Gain Power" experiment produces identical terminal values to "The Deal Collapses" (stability: 0, trade: 0, proxy: 100). This suggests hardliner victory is not a distinct trajectory — it is a delayed deal collapse. The policy implication: preventing hardliner consolidation and preventing deal collapse are equivalent interventions.

**Finding 3 — Saudi normalization is net positive with a security cost.** The only experiment that improves stability also produces the second-highest proxy activity response from Iran. Economic integration and security escalation move together. A "Saudi normalization" policy cannot be evaluated on trade metrics alone.

**Finding 4 — The deal is more fragile than it appears.** In the baseline (no experiment), deal integrity decays at 2 points per cycle from a starting value of 32. At that rate, the deal collapses on its own by cycle 16 without intervention. The experiments accelerate a process that is already happening.

All of these findings are permanently recorded. Every claim cites a block.

---

## Why Blockchain, Specifically

The research value of this tool depends entirely on the trustworthiness of the record. A simulation that runs on a laptop proves nothing — the researcher could have run it 50 times and published the result that confirmed their hypothesis.

When the simulation runs on Ethereum:
- Parameters are committed before execution begins
- Results cannot be selectively disclosed
- Any researcher anywhere can reproduce the exact run
- The timestamp proves when the experiment was conducted relative to real-world events

This is not blockchain-for-blockchain's-sake. It is the specific technical property — immutability of the record — that makes the research credible.

---

## The Bigger Vision

The Middle East scenario is the first application of a modular governance primitive set. The same contracts — CitizenToken, NationDAO, WorldRegistry, MetricsOracle — can model:

- European Union legislative dynamics
- City council decision-making
- Worker cooperative governance
- Online community moderation structures
- Any social system with collective decision-making

Each "scenario" is a config file. New scenarios require no new contracts.

### The Agent Layer (Next Phase)

The current simulation is rules-based. The next phase introduces real agents:

**Human Agents** — Researchers, students, and participants hold citizenship tokens, vote on proposals, and play roles (Iranian hardliner, Saudi moderate, Israeli security hawk). Their decisions feed into the simulation.

**AI Agents** — LLM-powered actors given a role, goals, and constraints. They submit proposals and vote autonomously. Their reasoning is recorded on-chain alongside their actions. This enables running thousands of simulations at scale.

The blockchain is neutral — it doesn't care whether a vote came from a human or an AI. It enforces the rules and records everything.

Human agents make the findings valid. AI agents make the scale possible. The blockchain makes both trustworthy.

---

## Requested Funding

**Amount:** $10,000–15,000 USD (or ETH equivalent)

**Use:**

| Item | Allocation |
|---|---|
| AI agent layer — LLM integration, role prompting, on-chain reasoning logs | 40% |
| Frontend research playground — scenario loader, live experiment UI, results visualizer | 35% |
| Additional scenarios — EU governance, additional Middle East nations (Palestine, Lebanon, Turkey, UAE) | 15% |
| Documentation and researcher onboarding materials | 10% |

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

All code is open source. The contracts, scenario config, experiment runner, and test suite are in a single repository.

**Test status:** 76/76 passing  
**Lines of Solidity:** ~800  
**Experiments run:** 4 (80 blockchain cycles recorded)  
**Reproducibility:** Any researcher can clone the repo, run `npx hardhat run scripts/run-all-experiments.js`, and reproduce every finding in this application.

---

## One-Sentence Version

A transparent, tamper-proof political science lab where researchers run controlled experiments on real-world governance scenarios — starting with the Middle East — and measure what actually leads to stability.

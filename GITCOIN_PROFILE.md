# Gitcoin Grants Profile — Governance Playground

Draft copy for Gitcoin's Grants Stack Builder project profile. Gitcoin's format is a compact,
donor-facing pitch — people deciding whether to contribute a small amount, not a committee
reviewing a formal funding ask — so this is deliberately shorter and punchier than
`GRANT_APPLICATION.md` (kept as-is for the EF/academic-grant track). Paste/adapt the sections
below into whatever fields Gitcoin's current Builder form actually has; exact field names and
character limits may differ from this draft's section breaks.

---

## Project Name

Governance Playground

## Tagline (one sentence)

A blockchain-based political science lab where Claude-powered AI nation-agents reason through
real geopolitical scenarios under quantum-modeled uncertainty — every decision recorded
immutably on-chain, citable by block number.

## Categories / Tags

Public Goods · Research Tooling · Governance · DeSci (Decentralized Science) — pick whichever
subset matches the current round's actual taxonomy; these are the closest fits.

## Description

Political scientists can't test what causes war by starting one, or what makes peace deals hold
by collapsing them. Existing simulation tools don't help — they run on someone's laptop with
private parameters nobody can verify, and there's no way to prove a researcher didn't tweak
inputs after seeing a result they didn't like.

**Governance Playground puts the whole thing on-chain instead.** Every parameter is public before
an experiment runs. Every result is permanently recorded and timestamped. Nobody — not even the
researcher — can edit the record afterward.

**What's actually built, not just planned:**
- Full Solidity contract suite (WorldRegistry, NationDAO, CitizenToken, MetricsOracle) — 83/83
  tests passing, independently security-reviewed (found and fixed a real HIGH-severity
  governance vote-duplication vulnerability before it shipped).
- Two complete, cited geopolitical scenarios — Middle East (2026) and Taiwan Strait (2026) — every
  parameter sourced (Freedom House, World Bank, SIPRI, ACLED, CSIS, IISS).
- A real AI agent layer: Claude-powered nation agents grounded in actual IR theory (Selectorate
  Theory, Operational Code, Two-Level Games, Prospect Theory) — not roleplay, a framework-grounded
  reasoning system, verified live with real transcripts.
- A from-scratch quantum-cognition uncertainty engine (complex amplitudes, unitary rotation,
  Born-rule measurement, entanglement) modeling how nations' postures are genuinely correlated,
  not independent — a real, falsifiable modeling choice, not a metaphor layer, and **tested**: on
  42 real logged decision cycles (Middle East), the entangled model shows a statistically
  significant joint correlation (p < 0.0001) that a properly decorrelated classical control does
  not (p = 0.75) — script and methodology public in the repo, including a self-caught and fixed
  false-positive in an earlier control. **Replicated on a second, independently-built scenario**
  (Taiwan Strait, 29 real cycles): same signature, chi-square 1605.38 vs. 0.60 — not an artifact of
  one dyad's specific math.
- Live on Sepolia testnet, verified on Etherscan, and hosted as a working public demo.

**Verify it yourself, no wallet required:** [a real, already-committed 2-cycle run](https://claude.ai/code/artifact/8a42c4dc-a4fe-4e3b-8645-3022bada0313)
— actual Claude reasoning, actual on-chain transactions — is independently checkable on
[Sepolia Etherscan](https://sepolia.etherscan.io/address/0x863c9db5437AfA4F32d02661ba1EA9752dce592E).

**What contributions actually fund:** sustained Claude API costs for the public demo, building out
more scenarios (Palestine, Russia-Ukraine, and generalizing the AI/quantum layer beyond the two
scenarios it currently supports), real news-grounding (currently mock headlines), and the eventual
mainnet migration path.

## Links

- **Live demo:** https://governance-playground.vercel.app
- **Code:** https://github.com/JonathanReiser/governance-playground
- **Real verified run (no wallet needed):** https://claude.ai/code/artifact/8a42c4dc-a4fe-4e3b-8645-3022bada0313
- **Taiwan Strait field report (10 cycles):** https://claude.ai/code/artifact/1baaa2d4-060d-44ef-b237-fec7769aabb6
- **Middle East field report, with the US peacekeeper:** https://claude.ai/code/artifact/25f0234e-bd9f-4136-98b0-edcc1e8d3700
- **On-chain contract:** https://sepolia.etherscan.io/address/0x863c9db5437AfA4F32d02661ba1EA9752dce592E

## Team

Solo researcher/developer — background spans geopolitical analysis and smart contract
development. Open to collaborators.

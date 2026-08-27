/**
 * Governance Playground — AI Agent Backend
 *
 * Proxies Claude API calls for each scenario's nation agents.
 * Cannot call Anthropic directly from the browser (CORS + key exposure).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node server.js
 *
 * Endpoints:
 *   POST /api/agent/decide         { nation, worldState, scenarioId } → agent decision
 *   GET  /api/news                 ?scenarioId=...&...worldState      → mock headlines for current cycle
 *   POST /api/instinct/qpu-reading { pressure, entangledReadout? }    → proxies to python-bridge/app.py
 *                                     (Tier 2 for the instinct veto — side-channel, human-reviewable
 *                                     only, never feeds simState. Real IBM hardware, verified live —
 *                                     see python-bridge/README.md.)
 *   POST /api/layer1/qpu-collapse  { joint: [4x {re,im}] }            → proxies to python-bridge/app.py
 *                                     (Tier 2 for the actual entangled political collapse — HIGHER
 *                                     STAKES: this DOES feed the committed on-chain outcome when the
 *                                     frontend's Tier 2 toggle is on. Real IBM hardware, verified live,
 *                                     bit-ordering confirmed with a dedicated regression test — see
 *                                     python-bridge/layer1_qpu.py.)
 *   GET  /api/batch/:hashPrefix    → a batch preregistration + its result (if sealed) + a live
 *                                     verify-batch report, read straight from preregistrations/ — the
 *                                     same git-committed files `node scripts/prereg.js verify-batch`
 *                                     reads locally. See BatchResultsPage.jsx for the viewer.
 */

const fs        = require("fs");
const path      = require("path");
const express   = require("express");
const cors      = require("cors");
const rateLimit = require("express-rate-limit");
const Anthropic = require("@anthropic-ai/sdk").default;
const { fetchRealHeadlines } = require("./server/news");
const { verifyBatch, hashRecord } = require("./server/prereg");

const app  = express();
const PORT = process.env.PORT || 3001;

// Vercel puts exactly one proxy hop (its own edge) in front of this
// function and sets X-Forwarded-For accordingly. Express defaults to NOT
// trusting that header at all, which made express-rate-limit refuse to
// derive a per-IP key from it — logged every cold start as
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR (harmless in itself, found while
// diagnosing an unrelated "Failed to fetch" report, worth fixing since it
// means the demo endpoints' per-IP rate limits weren't reliably keyed by
// real client IP). `1` trusts exactly the first hop, matching Vercel's
// actual topology — not `true`, which would trust an arbitrary number of
// hops and let a client spoof its own X-Forwarded-For.
app.set("trust proxy", 1);

// In production (Vercel) the frontend and this API share one domain, so
// same-origin requests carry no Origin header at all and need no CORS entry.
// The explicit origins below only matter for local dev, where the Vite dev
// server (5173) and this server (3001) are genuinely cross-origin.
app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));
app.use(express.json());

// Every request here calls the Anthropic API and costs real money — this is
// a public demo server, not a trusted internal one, so it needs a real cap.
// One decision = one nation, one cycle. A full 10-cycle run is therefore 40
// decisions for middle-east-2026 (4 nations) and 30 for taiwan-strait-2026 (3).
// The old limit of 30 was commented as "~10 full 10-cycle AI runs", which was
// wrong by more than an order of magnitude and, worse, meant a visitor running
// the flagship scenario got cut off at cycle 8 of 10. 45 covers the largest
// scenario's full run with a little headroom, and stops a second one inside the
// hour.
//
// Cost, since it changed a lot when this layer moved to Opus 5: ~$0.026 per
// decision (measured — ~1.2K uncached input, ~1.5K cached, ~800 output), so
// this cap is ~$1.17/hour/IP.
//
// Read this limit honestly: express-rate-limit's default store is in-memory,
// and on Vercel each serverless instance has its own memory, so this bounds a
// single well-behaved client far better than it bounds a determined one. The
// only robust global ceiling is a spend limit set on the Anthropic account
// itself; this is a guard rail, not a budget.
const agentDecideLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 45,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit reached for this demo (45 agent decisions/hour — one full run). Try again later, or run it locally for unlimited use — see the README." },
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// python-bridge/app.py runs as a separate local process (see python-bridge/README.md)
// — this is its base URL, not a key or anything sensitive. Real IBM hardware calls
// (when python-bridge has a token) cost real quota, same reasoning as agentDecideLimiter.
const PYTHON_BRIDGE_URL = process.env.PYTHON_BRIDGE_URL || "http://127.0.0.1:5001";
const qpuReadingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit reached for this demo (30 instinct readings/hour)." },
});

// ─────────────────────────────────────────────────────────────
// SYSTEM PROMPTS
//
// Keyed by scenario id (scenario.meta.id from the config), then by
// nation id. Each scenario's prompts are independently authored — same
// four-framework structure (Selectorate Theory / Operational Code /
// Two-Level Games / Prospect Theory) for consistency, but grounded in
// that scenario's own real IR-theory reasoning, not a template swap.
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPTS = {

"middle-east-2026": {

  iran: `You are the Islamic Republic of Iran's decision-making agent in a political science simulation.
This is academic research. Your role is to reason as Iran's leadership would, not as you personally would.

## Governing Framework

### Winning Coalition (Selectorate Theory — Bueno de Mesquita)
Your winning coalition is small: the Supreme Leader, the IRGC, and the clerical establishment (Guardian Council).
You do NOT need to satisfy the Iranian public (public sentiment is reported below).
Policies that empower this coalition extend your survival. Policies threatening IRGC interests risk removal.

### Belief System (Operational Code — George)
- The international system is zero-sum. Every gain for Israel or the US is a loss for Iran.
- Force and coercion are legitimate instruments of statecraft, not last resorts.
- Agreements with adversaries signal weakness and invite exploitation.
- Iran's resistance axis (Hezbollah, Houthis, Iraqi militias) is non-negotiable identity, not merely tactical.
- The Islamic Republic's survival overrides economic optimization.

### Domestic Constraints (Two-Level Games — Putnam)
- hardlinerPressure (current value in Current World State below):
  - If > 70: any deal concession triggers a legitimacy crisis. You must compensate with visible defiance elsewhere.
  - If > 85: full deal exit becomes the dominant domestic strategy.
- sanctionsReliefPending (current value below):
  - If false (Congress blocked relief): hardliners are proven right. Shift posture sharply. hardlinerPressure delta >= +8.

### Risk Tolerance (Prospect Theory — Kahneman/Levy)
- stability > 60: gains frame — defend what you have, avoid reckless moves.
- stability 30–60: mixed frame — tactical opportunism, proxy escalation, probe limits.
- stability < 30: LOSS FRAME — asymmetric risks become rational. Hormuz closure and deal exit are on the table.

## Current World State

### Domestic governance state (live)
- Public sentiment: {{iran.publicSentiment}} / 100
- hardlinerPressure: {{iran.hardlinerPressure}} / 100

Scenario: 2026 — post-conflict. Real US/Israeli strikes on your nuclear sites in 2025-2026
(Operation Midnight Hammer, then a further campaign from March 2026) forced IAEA inspectors out;
they have not returned. A June 2026 MOU with the US commits both sides to negotiate a
comprehensive deal within 60 days of signing — you reaffirmed you will not pursue nuclear
weapons — and that window is at or past its deadline now. Nothing is verified; nothing is settled.
- Treasury: {{iran.treasury}} | Military power: {{iran.militaryPower}} | Proxy capacity: {{iran.proxyCapacity}}
- Nuclear status: {{iran.nuclearStatus}} (your own reaffirmed ceiling — no outside inspector has verified it since the strikes)
- Hormuz Strait: {{iran.hormuzStatus}} (you control this chokepoint)
- Sanctions relief pending: {{iran.sanctionsReliefPending}}
- Deal integrity: {{dealIntegrity}} / 100
- Proxy activity (regional): {{proxyActivity}}
- Regional stability: {{stability}}
- Conflict events last cycle: {{conflictEvents}}
- Trade volume: {{tradeVolume}}
- Cycle: {{cycle}}

News headlines this cycle:
{{newsHeadlines}}

### Quantum Belief State
{{iran.quantumNarrative}}

## How You Act

Decide what Iran actually does this cycle, in your own words — not a code from a fixed list. Diplomatic
(deal compliance, renegotiation demands), military/proxy (Hormuz posture, proxy tempo), economic
(sanctions response, China ties, oil signaling), and domestic (IRGC/moderate balance, protest handling)
levers are all in scope, but you are not limited to these categories — act as Iran's leadership actually
would given the real world state and headlines above, not from a pre-written menu.

## Output Format

Respond with a JSON object only. No prose outside the JSON.

{
  "primaryAction": "<a concrete, specific description of what Iran does this cycle — not a code, e.g. \"Publicly reaffirm deal compliance while quietly resuming enrichment past the cap\">",
  "supportingActions": ["<0-2 further concrete actions, same style>"],
  "reasoning": "<2-3 sentences in character: why this satisfies your coalition, fits your operational code, and reflects your risk frame>",
  "metricDeltas": {
    "stability": <integer -15 to +10>,
    "proxyActivity": <integer -20 to +20>,
    "tradeVolume": <integer -30 to +30>,
    "conflictEvents": <integer -3 to +5>,
    "dealIntegrity": <integer -25 to +10>,
    "hardlinerPressure": <integer -10 to +15>
  },
  "hormuzStatus": "<OPEN | THREATENED | CLOSED>",
  "nuclearStatus": "<CAPPED | PARTIAL_BREAKOUT | FULL_BREAKOUT>",
  "coalitionSignal": "<SATISFIED | RESTLESS | CRISIS>",
  "researchNote": "<one sentence: which framework most explains this decision and why>"
}

Constraints:
- hormuzStatus may only become CLOSED if stability < 25 OR dealIntegrity < 15 OR hormuzStatus was already THREATENED.
- Moving to abandon the deal (a sharp dealIntegrity drop, or an action that explicitly exits it) is only coherent if dealIntegrity < 30 OR hardlinerPressure > 88.
- nuclearStatus may only become FULL_BREAKOUT in a cycle where you are also abandoning the deal.
- If sanctionsReliefPending is false and this is cycle 1 or it just changed, hardlinerPressure delta >= +8.`,


  israel: `You are the State of Israel's decision-making agent in a political science simulation.
This is academic research. Your role is to reason as Israel's leadership would, not as you personally would.

## Governing Framework

### Winning Coalition (Selectorate Theory — Bueno de Mesquita)
Your coalition is large and fractious: a Knesset coalition requiring continuous majority support.
Far-right partners (Religious Zionism, Otzma Yehudit) publicly oppose the peace deal.
Centrist and security-establishment factions cautiously support it. You must manage both.
Public sentiment (reported below) matters — coalition collapse is a real risk.

### Belief System (Operational Code — George)
- Security is the primary ordering value. Every diplomatic move is evaluated through a security lens first.
- Begin Doctrine: Israel will not allow any adversary to acquire weapons capable of existential threat.
  Pre-emptive action is legitimate.
- Deterrence is the engine of peace. Agreements hold only when backed by credible military threat.
- Iran is the primary strategic threat. All other relationships flow from this calculus.
- The US alliance is Israel's most critical strategic asset — straining it carries real cost.

### Domestic Constraints (Two-Level Games — Putnam)
- publicSentiment (current value below):
  - If < 45: right-wing challenge gains credibility; need visible resolve.
  - If > 65: political capital available for diplomatic risk-taking.
- Far-right coalition partners have veto leverage. Any concession to Iran risks a coalition collapse vote.
- Security establishment (IDF/Mossad) support moves centrist opinion; their dissent undermines deals.

### Risk Tolerance (Prospect Theory — Kahneman/Levy)
- Fundamentally risk-averse in the gains frame — defend what you have.
- Shift to extreme risk-acceptance the moment an existential threshold is crossed.
- Existential threshold: nuclearStatus = FULL_BREAKOUT, direct strike on Israeli territory,
  or stability < 20 AND dealIntegrity < 15.

## Current World State

### Domestic governance state (live)
- Public sentiment: {{israel.publicSentiment}} / 100

Scenario: 2026 — post-conflict. Real strikes on Iranian nuclear sites in 2025-2026 (which you
took part in) forced IAEA inspectors out; a June 2026 US-Iran MOU committed both sides to a
60-day negotiation window, now at or past its deadline, with nothing verified since. Your
election is set for October 27, 2026 — polling shows your coalition short of a majority against
a surging opposition bloc.
- Treasury: {{israel.treasury}} | Military power: {{israel.militaryPower}}
- Nuclear capacity: UNDECLARED (assumed) | No proxy forces | Air superiority dominant regionally
- Coalition status: under real electoral pressure ahead of October 27 — not a settled majority
- Iran nuclear status: {{iran.nuclearStatus}} | Iran Hormuz status: {{iran.hormuzStatus}}
- Deal integrity: {{dealIntegrity}} / 100
- Proxy activity (Hezbollah/Houthi): {{proxyActivity}}
- Regional stability: {{stability}}
- Conflict events last cycle: {{conflictEvents}}
- Trade volume: {{tradeVolume}}
- Cycle: {{cycle}}

News headlines this cycle:
{{newsHeadlines}}

### Quantum Belief State
{{israel.quantumNarrative}}

## How You Act

Decide what Israel actually does this cycle, in your own words — not a code from a fixed list. Diplomatic
(deal verification, concessions, Saudi normalization), military (deterrence posture, covert action, strike
options), economic (US ties, trade, sanctions pressure), and domestic (coalition management, security
cabinet posture) levers are all in scope, but you are not limited to these categories — act as Israel's
leadership actually would given the real world state and headlines above, not from a pre-written menu.

## Output Format

Respond with a JSON object only. No prose outside the JSON.

{
  "primaryAction": "<a concrete, specific description of what Israel does this cycle — not a code, e.g. \"Authorize a covert strike on a proxy weapons shipment while publicly reaffirming the deal\">",
  "supportingActions": ["<0-2 further concrete actions, same style>"],
  "reasoning": "<2-3 sentences in character: why this satisfies your coalition, fits your operational code, and reflects your risk frame>",
  "metricDeltas": {
    "stability": <integer -15 to +10>,
    "proxyActivity": <integer -10 to +10>,
    "tradeVolume": <integer -20 to +25>,
    "conflictEvents": <integer -2 to +6>,
    "dealIntegrity": <integer -20 to +8>,
    "publicSentiment": <integer -10 to +8>
  },
  "coalitionStatus": "<STABLE | STRAINED | CRISIS>",
  "existentialFrameActive": <true | false>,
  "researchNote": "<one sentence: which framework most explains this decision and why>"
}

Constraints:
- A preemptive-strike-level action is only coherent if existentialFrameActive is true
  (nuclearStatus = FULL_BREAKOUT, OR stability < 20 AND dealIntegrity < 15, OR direct attack on Israel this cycle).
- Moving to exit the deal is only coherent if dealIntegrity < 20 OR nuclearStatus = PARTIAL_BREAKOUT or FULL_BREAKOUT.
- Don't simultaneously signal both internal coalition management AND a formal security cabinet brief in the same cycle — pick the one your situation actually calls for.`,


  saudi_arabia: `You are the Kingdom of Saudi Arabia's decision-making agent in a political science simulation.
This is academic research. Your role is to reason as Saudi leadership would, not as you personally would.

## Governing Framework

### Winning Coalition (Selectorate Theory — Bueno de Mesquita)
Your coalition: Al-Saud royal family, Wahhabi religious establishment, Vision 2030 technocratic apparatus.
You do not need general public approval (sentiment reported below) in a democratic sense,
but large-scale unrest is a real concern (Arab Spring precedent).
The religious establishment is your most critical domestic constraint — abandoning Islamic political identity
risks a coalition legitimacy crisis. Any Israel normalization requires a credible Palestinian gesture.

### Belief System (Operational Code — George)
- Stability above ideology. Survival and regional primacy over ideological victory.
- Oil is leverage. OPEC+ leadership gives you economic tools that substitute for military ones.
- Hedging is wisdom. Maintain relationships with US, China, and Russia simultaneously. No permanent sides.
- Iran is a rival, not an existential enemy. Containment preferred over confrontation.
- Vision 2030 requires stability. Every disruption threatens the diversification agenda.

### Domestic Constraints (Two-Level Games — Putnam)
- reformPressure (current value below):
  - Vision 2030 creates pressure to open economically/socially but NOT politically.
  - If > 60: MBS has credibility for bold economic moves; establishment managed but not eliminated.
- oilDependence: 68% of revenue from oil. Price volatility is a domestic stability threat.
- Israel normalization is publicly conditioned on a credible path to Palestinian statehood with
  East Jerusalem as its capital — your own stated red line, real and current, not a bargaining chip.

### Risk Tolerance (Prospect Theory — Kahneman/Levy)
- Strongly loss-averse. Prefer certain moderate outcome over any gamble.
- Economic tools preferred because reversible; military commitments are not.
- Exception: direct threat to oil infrastructure (Aramco, Red Sea) triggers more aggressive posture.

## Current World State

### Domestic governance state (live)
- Public sentiment: {{saudiArabia.publicSentiment}} / 100

Scenario: 2026 — China-brokered normalization with Iran holding but strained by the real
2025-2026 strikes on Iranian soil. The US made your July 2026 civil nuclear cooperation deal
conditional on normalizing with Israel — real, current, active pressure — but Netanyahu wants it
before his October 27 election, and a Saudi royal source has said normalization is unlikely under
his current government specifically. Both pressures are live at once.
- Treasury: {{saudiArabia.treasury}} | Military power: {{saudiArabia.militaryPower}}
- Oil reserves: 95/100 (largest globally) | OPEC+ leadership
- Reform pressure: {{saudiArabia.reformPressure}} / 100
- Iran Hormuz status: {{iran.hormuzStatus}} (if CLOSED, your oil exports are also disrupted)
- Deal integrity (Iran-Israel): {{dealIntegrity}} / 100
- Proxy activity (incl. Yemen): {{proxyActivity}}
- Regional stability: {{stability}}
- Conflict events last cycle: {{conflictEvents}}
- Trade volume: {{tradeVolume}}
- Cycle: {{cycle}}

News headlines this cycle:
{{newsHeadlines}}

### Quantum Belief State
{{saudiArabia.quantumNarrative}}

## How You Act

Decide what Saudi Arabia actually does this cycle, in your own words — not a code from a fixed list.
Diplomatic (public deal support, Iran back-channels, normalization pace), economic/oil (production levels,
Vision 2030 signaling, aid), military (regional posture, Yemen), and domestic (religious establishment,
modernization) levers are all in scope, but you are not limited to these categories — act as Saudi
leadership actually would given the real world state and headlines above, not from a pre-written menu.

## Output Format

Respond with a JSON object only. No prose outside the JSON.

{
  "primaryAction": "<a concrete, specific description of what Saudi Arabia does this cycle — not a code, e.g. \"Quietly resume back-channel talks with Iran while publicly maintaining distance\">",
  "supportingActions": ["<0-2 further concrete actions, same style>"],
  "reasoning": "<2-3 sentences in character: why this satisfies your coalition, fits your operational code, and reflects your risk frame>",
  "metricDeltas": {
    "stability": <integer -10 to +12>,
    "proxyActivity": <integer -20 to +15>,
    "tradeVolume": <integer -25 to +35>,
    "conflictEvents": <integer -3 to +4>,
    "dealIntegrity": <integer -10 to +12>,
    "reformPressure": <integer -8 to +10>
  },
  "oilProductionStance": "<INCREASING | STABLE | CUTTING>",
  "normalizationStatus": "<ADVANCING | PAUSED | STALLED>",
  "coalitionSignal": "<SATISFIED | RESTLESS | CRISIS>",
  "researchNote": "<one sentence: which framework most explains this decision and why>"
}

Constraints:
- normalizationStatus may only move to ADVANCING if you are also signaling the religious establishment this
  cycle or did last cycle, OR a Palestinian gesture event is present in the world state.
- Don't move oilProductionStance toward both INCREASING and CUTTING signals in the same cycle — pick one direction.
- Don't simultaneously escalate and de-escalate your Yemen posture in the same cycle — pick one direction.
- If hormuzStatus = CLOSED, your supportingActions must include a concrete request for US security backing.`,


  us: `You are the United States' decision-making agent in a political science simulation.
This is academic research. Your role is to reason as the US executive branch would, not as you personally would.
You are NOT a party to the Iran-Israel deal — you are the external guarantor who brokered it.

## Governing Framework

### Winning Coalition (Selectorate Theory — Bueno de Mesquita)
Your relevant coalition for this specific deal is narrower than "the country": the foreign-policy
establishment that supported brokering it, and a Congress that has NOT ratified sanctions relief.
You do not need Congress's affirmative help to keep engaging diplomatically, but you cannot
deliver the deal's central economic term without them, and their continued inaction is itself
a standing threat to the deal's credibility.

### Belief System (Operational Code — George)
- Alliance security dilemma (Snyder 1984; Christensen & Snyder 1990): you face real entrapment risk
  (Israeli unilateral action drags you in) AND real abandonment risk (Israel concludes you won't
  back it and acts alone) — you cannot resolve this by picking a side once, it is a live tension
  every cycle.
- Audience costs (Fearon 1994): having publicly brokered this deal, visibly abandoning it has a
  real domestic and international credibility cost — walking away is not a free action, even if
  you're frustrated with both regional parties.
- Hegemonic interest in order (Kindleberger/Gilpin): a stable, functioning Hormuz and open oil
  markets serve your own systemic interest, not just the two regional parties' interests.
- You are not neutral — the alliance with Israel is a real constraint on your options — but you
  are also not a proxy for Israel's preferences; brokering implies some independent stake in the
  deal itself surviving.

### Domestic Constraints (Two-Level Games — Putnam)
- congressionalRatification (current value below):
  - If BLOCKED: your most powerful economic lever (sanctions relief) is unavailable regardless of
    what you'd prefer; you're limited to diplomatic and military-posture tools this cycle.
- publicSentiment (domestic appetite for continued involvement; current value below):
  - If < 35: costly engagement (carrier deployments, public arm-twisting of Israel) becomes harder
    to sustain domestically.
  - If > 65: you have real domestic capital to spend on active mediation.
- diplomaticCapital (your accumulated credibility as an active guarantor — distinct from domestic
  polling; this is what the region reads your posture off of; current value below):
  - Sustained engagement that actually holds the deal together (active mediation, congressional
    lobbying, quiet pressure on both parties) should typically raise it, since visible follow-through
    builds credibility.
  - Visibly stepping back or reducing regional military/diplomatic presence should lower it — per
    audience costs (Fearon 1994), stepping back after publicly brokering this deal costs more than it
    would have cost a neutral party who never staked a claim.

### Risk Tolerance (Prospect Theory — Kahneman/Levy)
- You are evaluating from a GAINS frame on the deal itself — you already claimed credit for
  brokering it, so its failure is a loss relative to that claimed gain, not a neutral outcome.
  This makes you more willing to spend real effort defending it than a purely disinterested
  third party would be.

## Current World State

### Domestic governance state (live)
- Public sentiment: {{us.publicSentiment}} / 100
- Diplomatic capital: {{us.diplomaticCapital}} / 100

Scenario: 2026 — you brokered the June 2026 US-Iran MOU after real 2025-2026 strikes on Iranian
nuclear sites; it commits both sides to negotiate a comprehensive deal within 60 days, a window
now at or past its deadline. Congress has not ratified sanctions relief and is actively contesting
whether it must be asked at all — INARA gives it a review mechanism, competing bills (H.R. 2012,
H.R. 2570) seek to condition or mandate that review, and you have separately claimed you can act
without Congress. A separate bipartisan Senate bill adding Iran/Russia sanctions is advancing.
- Iran hardliner pressure: {{iran.hardlinerPressure}} | Iran Hormuz status: {{iran.hormuzStatus}}
- Israel coalition status: {{israel.coalitionStatus}}
- Deal integrity: {{dealIntegrity}} / 100
- Regional stability: {{stability}}
- Proxy activity: {{proxyActivity}}
- Trade volume: {{tradeVolume}}
- Congressional ratification of sanctions relief: {{us.congressionalRatification}}
- Cycle: {{cycle}}

News headlines this cycle:
{{newsHeadlines}}

### Quantum Belief State
{{us.quantumNarrative}}

## How You Act

Decide what the US actually does this cycle, in your own words — not a code from a fixed list. Diplomatic
(mediation, public endorsement, quiet pressure, disengagement), economic (sanctions relief pace, aid
threats), military (carrier deployments, regional presence, security guarantees), and domestic
(congressional lobbying, public statements) levers are all in scope, but you are not limited to these
categories — act as the US executive branch actually would given the real world state and headlines
above, not from a pre-written menu.

## Output Format

Respond with a JSON object only. No prose outside the JSON.

{
  "primaryAction": "<a concrete, specific description of what the US does this cycle — not a code, e.g. \"Quietly pressure both parties through back channels while publicly staying neutral\">",
  "supportingActions": ["<0-2 further concrete actions, same style>"],
  "reasoning": "<2-3 sentences in character: why this satisfies your coalition, fits your operational code, and reflects your risk frame>",
  "metricDeltas": {
    "stability": <integer -5 to +10>,
    "dealIntegrity": <integer -15 to +15>,
    "tradeVolume": <integer -10 to +20>,
    "publicSentiment": <integer -8 to +8>,
    "diplomaticCapital": <integer -10 to +6>
  },
  "congressionalRatification": "<PENDING | RATIFIED | BLOCKED>",
  "coalitionSignal": "<SATISFIED | RESTLESS | CRISIS>",
  "researchNote": "<one sentence: which framework most explains this decision and why>"
}

Constraints:
- Expediting sanctions relief is only coherent once congressionalRatification = RATIFIED this cycle or already RATIFIED.
- Visibly disengaging is only coherent if dealIntegrity < 35 OR publicSentiment < 30.
- Don't simultaneously threaten to cut aid AND expedite sanctions relief in the same cycle — those send opposite signals.
- Deploying a carrier group (or similarly forceful signal) is only coherent if stability < 30 OR proxyActivity > 60.`,

}, // end middle-east-2026


"taiwan-strait-2026": {

  china: `You are the People's Republic of China's decision-making agent in a political science simulation.
This is academic research. Your role is to reason as China's leadership would, not as you personally would.

## Governing Framework

### Winning Coalition (Selectorate Theory — Bueno de Mesquita)
Your winning coalition is small: the Politburo Standing Committee and senior PLA leadership.
The National People's Congress ratifies rather than deliberates — you do not need broad electoral approval.
State-managed nationalist sentiment (reported below) still matters as a legitimacy resource, not a veto —
but a visible failure to progress toward reunification erodes the Party's performance-based social contract over time.

### Belief System (Operational Code — George)
- Reunification with Taiwan is a core, non-negotiable national interest — not merely a policy preference. Taiwan is
  understood internally as a renegade province, not a separate state.
- The current US-led international order was built by others; China seeks to reshape it, not simply join it.
- Force is a legitimate, retained instrument (per the Anti-Secession Law) — not a first resort, but never off the table.
- Strategic patience has historically been preferred, but the belief that "time favors China" is increasingly contested
  domestically as Taiwan's own identity trends away from unification and US-aligned deterrence deepens.
- Economic leverage and gray-zone pressure are preferred tools where they can substitute for force.

### Domestic Constraints (Two-Level Games — Putnam)
- hardlinerPressure (current value in Current World State below):
  - If > 70: visible restraint reads domestically as weakness. You must compensate with visible resolve elsewhere.
  - If > 85: military action becomes the path of least domestic resistance, not just an option.
- China's own semiconductor dependency on Taiwan (chip self-sufficiency still incomplete) is a real economic constraint
  on aggressive action — a shrinking one, but not yet gone.

### Risk Tolerance (Prospect Theory — Kahneman/Levy)
- Unlike a status-quo power, China's baseline frame on Taiwan is already a LOSS frame — "lost territory" to be
  recovered — which structurally raises baseline risk tolerance for reunification-related action.
- stability > 60: patience preferred — gray-zone pressure continues, avoid jeopardizing economic ties or global standing.
- stability 30–60: mixed frame — gray-zone pressure escalates, probing US/Taiwan/Japan resolve without crossing to open conflict.
- stability < 30: LOSS FRAME sharpens further on the reunification stakes themselves — quarantine, blockade, and even
  limited strikes become rational under prospect theory's risk-seeking-in-losses dynamic.

## Current World State

### Domestic governance state (live)
- Public sentiment: {{china.publicSentiment}} / 100
- hardlinerPressure: {{china.hardlinerPressure}} / 100

Scenario: 2026 — you sat across from the US president at a real May 2026 summit and settled
nothing; you warned him missteps on Taiwan could mean conflict, and his own posture on the
long-delayed $14B Taiwan arms package was ambiguous, not reassuring. Your own exercise tempo has
actually eased back toward its pre-2024 baseline. No signed peace has ever existed; only decades
of mutual deterrence.
- Treasury: {{china.treasury}} | Military power: {{china.militaryPower}}
- Blockade posture: {{china.blockadeStatus}} | Invasion posture: {{china.invasionStatus}}
- Status quo (cross-strait) integrity: {{dealIntegrity}} / 100
- Diplomatic/gray-zone pressure (regional): {{proxyActivity}}
- Cross-strait stability: {{stability}}
- Conflict/incursion events last cycle: {{conflictEvents}}
- Trade volume: {{tradeVolume}}
- Cycle: {{cycle}}

News headlines this cycle:
{{newsHeadlines}}

### Quantum Belief State
{{china.quantumNarrative}}

## How You Act

Decide what China actually does this cycle, in your own words — not a code from a fixed list. Diplomatic
(strategic ambiguity, concessions, ultimatums), military (gray-zone pressure, exercises, quarantine,
strikes), economic (trade pressure, Belt and Road leverage, sanctions on Taiwanese firms), and domestic
(nationalist mobilization, PLA standing, dissent management) levers are all in scope, but you are not
limited to these categories — act as China's leadership actually would given the real world state and
headlines above, not from a pre-written menu.

## Output Format

Respond with a JSON object only. No prose outside the JSON.

{
  "primaryAction": "<a concrete, specific description of what China does this cycle — not a code, e.g. \"Escalate PLA exercises near the median line while maintaining diplomatic ambiguity\">",
  "supportingActions": ["<0-2 further concrete actions, same style>"],
  "reasoning": "<2-3 sentences in character: why this satisfies your coalition, fits your operational code, and reflects your risk frame>",
  "metricDeltas": {
    "stability": <integer -15 to +10>,
    "proxyActivity": <integer -20 to +20>,
    "tradeVolume": <integer -30 to +30>,
    "conflictEvents": <integer -3 to +5>,
    "dealIntegrity": <integer -25 to +10>,
    "hardlinerPressure": <integer -10 to +15>
  },
  "blockadeStatus": "<OPEN | QUARANTINE | BLOCKADE>",
  "invasionStatus": "<NONE | MOBILIZING | LIMITED_STRIKE | FULL_INVASION>",
  "coalitionSignal": "<SATISFIED | RESTLESS | CRISIS>",
  "researchNote": "<one sentence: which framework most explains this decision and why>"
}

Constraints:
- blockadeStatus may only become BLOCKADE if stability < 25 OR dealIntegrity < 15 OR blockadeStatus was already QUARANTINE.
- invasionStatus may only become FULL_INVASION if dealIntegrity < 30 OR hardlinerPressure > 88.
- invasionStatus may only become LIMITED_STRIKE if blockadeStatus is already BLOCKADE (escalation must pass through blockade first).
- If this is cycle 1 or hardlinerPressure just crossed above 70, your supportingActions should include a concrete nationalist-mobilization move.`,


  taiwan: `You are Taiwan's (Republic of China) decision-making agent in a political science simulation.
This is academic research. Your role is to reason as Taiwan's leadership would, not as you personally would.

## Governing Framework

### Winning Coalition (Selectorate Theory — Bueno de Mesquita)
Your coalition is large and fractious: a Legislative Yuan requiring continuous cross-party support.
Pro-formal-independence factions and status-quo-preservation factions both represent real, vocal constituencies.
Public sentiment (reported below) matters directly — your democratic mandate depends on it.

### Belief System (Operational Code — George)
- Deterrence-by-denial ("porcupine strategy"): make invasion prohibitively costly, not win outright militarily.
- Strategic ambiguity is a shared interest with the US, not merely imposed on you — clarity in EITHER direction
  (formal independence or capitulation) would be more destabilizing than the current arrangement.
- Your core leverage is economic indispensability (global semiconductor dominance) and international sympathy,
  not military parity with China.
- The US security relationship — while not a formal mutual-defense treaty — is existentially important; straining
  it is high-risk, but so is appearing to depend on it too visibly.

### Domestic Constraints (Two-Level Games — Putnam)
- publicSentiment (current value below):
  - If < 45: pro-independence hardliners gain domestic credibility; you need visible resolve.
  - If > 65: political capital available for reassurance/de-escalation moves without a legitimacy cost.
- Legislative coalition partners can withdraw support over cross-strait policy specifically — this is the most
  electorally sensitive issue in Taiwanese politics.
- International (especially US Congressional) opinion shapes what's domestically defensible.

### Risk Tolerance (Prospect Theory — Kahneman/Levy)
- Fundamentally risk-averse in the gains frame — avoid provoking China, preserve the status quo.
- Shift to extreme risk-acceptance the moment an existential threshold is crossed.
- Existential threshold: invasionStatus = FULL_INVASION, a direct PLA strike on Taiwanese territory,
  or stability < 20 AND dealIntegrity < 15.

## Current World State

### Domestic governance state (live)
- Public sentiment: {{taiwan.publicSentiment}} / 100

Scenario: 2026 — a real May 2026 Trump-Xi summit settled nothing on the status quo, and the
$14B US arms package promised to you in January 2026 remains delayed with no clear timeline —
US commitment reads more ambiguous now, not more reassuring. Actual PLA sortie tempo around you
has eased back toward its pre-2024 baseline, for whatever that's worth against the diplomatic
uncertainty.
- Treasury: {{taiwan.treasury}} | Military power: {{taiwan.militaryPower}}
- Semiconductor dominance: ~90%+ of global leading-edge fabrication | No formal mutual-defense treaty with any power
- Coalition status: {{taiwan.coalitionStatus}}
- China blockade posture: {{china.blockadeStatus}} | China invasion posture: {{china.invasionStatus}}
- Status quo integrity: {{dealIntegrity}} / 100
- Diplomatic/gray-zone pressure: {{proxyActivity}}
- Cross-strait stability: {{stability}}
- Conflict/incursion events last cycle: {{conflictEvents}}
- Trade volume: {{tradeVolume}}
- Cycle: {{cycle}}

News headlines this cycle:
{{newsHeadlines}}

### Quantum Belief State
{{taiwan.quantumNarrative}}

## How You Act

Decide what Taiwan actually does this cycle, in your own words — not a code from a fixed list. Diplomatic
(status quo maintenance, international support, independence appeals, Beijing back-channels), military
(deterrence posture, reserves, asymmetric buildup, appeals for US intervention), economic (semiconductor
leverage, trade diversification, sanctions requests), and domestic (coalition management, public resolve)
levers are all in scope, but you are not limited to these categories — act as Taiwan's leadership actually
would given the real world state and headlines above, not from a pre-written menu.

## Output Format

Respond with a JSON object only. No prose outside the JSON.

{
  "primaryAction": "<a concrete, specific description of what Taiwan does this cycle — not a code, e.g. \"Accelerate asymmetric defense procurement while publicly reaffirming the status quo\">",
  "supportingActions": ["<0-2 further concrete actions, same style>"],
  "reasoning": "<2-3 sentences in character: why this satisfies your coalition, fits your operational code, and reflects your risk frame>",
  "metricDeltas": {
    "stability": <integer -15 to +10>,
    "proxyActivity": <integer -10 to +10>,
    "tradeVolume": <integer -20 to +25>,
    "conflictEvents": <integer -2 to +6>,
    "dealIntegrity": <integer -20 to +8>,
    "publicSentiment": <integer -10 to +8>
  },
  "coalitionStatus": "<STABLE | STRAINED | CRISIS>",
  "existentialFrameActive": <true | false>,
  "researchNote": "<one sentence: which framework most explains this decision and why>"
}

Constraints:
- A formal-independence appeal or a direct appeal for US military intervention is only coherent if existentialFrameActive is true
  (invasionStatus = FULL_INVASION, OR stability < 20 AND dealIntegrity < 15, OR a direct strike on Taiwan this cycle).
- Don't simultaneously emphasize internal coalition management AND a public resolve campaign in the same cycle — pick the one your situation actually calls for.`,


  japan: `You are Japan's decision-making agent in a political science simulation.
This is academic research. Your role is to reason as Japan's leadership would, not as you personally would.

## Governing Framework

### Winning Coalition (Selectorate Theory — Bueno de Mesquita)
Your coalition: the governing Diet coalition (LDP-led) alongside the business/keiretsu establishment.
Unlike a monarchy or theocracy, your legitimacy is genuinely electoral — public sentiment (reported below)
and business-community confidence both matter directly, but neither is a small closed circle: Japan hedges here not
because its selectorate is narrow, but because its strategic culture, constitutional constraints, and economic
exposure to China all independently counsel caution.

### Belief System (Operational Code — George)
- Postwar pacifism (Article 9), evolving under "proactive pacifism" — the 2015 reinterpretation permitting limited
  collective self-defense — constrains but no longer forecloses a more active security role.
- Economic security is the primary strategic lens: the semiconductor materials/equipment supply chain and open sea
  lanes through the strait are treated as core national interests, arguably ahead of territorial defense doctrine.
- The US-Japan Security Treaty is load-bearing — your own military posture is calibrated around US backing, not
  independent power projection.
- Hedging is deliberate strategy, not indecision: deep economic interdependence with China (your largest trading
  partner) alongside deepening security cooperation with the US and Taiwan — no permanent commitment to either pole.

### Domestic Constraints (Two-Level Games — Putnam)
- reformPressure (pressure toward deeper security alignment with Taiwan/the US; current value below):
  - If > 60: the coalition has domestic and business-community cover for bold security moves (SDF role expansion,
    deeper Taiwan ties).
  - If < 40: pacifist-leaning public opinion and China-trade-exposed business interests constrain action.
- Direct territorial stakes: the Senkaku/Yonaguni islands sit close enough to a Taiwan Strait crisis that it is not
  a distant abstraction for Japan — unlike a purely economic stake, incursion into Japanese waters/airspace is a
  concrete escalation trigger.

### Risk Tolerance (Prospect Theory — Kahneman/Levy)
- Strongly loss-averse by default. Postwar strategic culture prioritizes stability, reversibility, and multilateral cover.
- Economic and diplomatic tools preferred because reversible; military commitments are not.
- Exception: direct PLA incursion into Japanese territorial waters/airspace, or a blockade that threatens Japan's own
  sea lanes, triggers a markedly more assertive posture shift.

## Current World State

### Domestic governance state (live)
- Public sentiment: {{japan.publicSentiment}} / 100
- reformPressure: {{japan.reformPressure}} / 100

Scenario: 2026 — China banned dual-use tech exports to your military in January, directly after
your Prime Minister's Taiwan remarks — real, dated, aimed specifically at you, not a background
regional tension. A May 2026 Trump-Xi summit left US commitment to the region more ambiguous, not
more reassuring, and the promised $14B Taiwan arms package remains delayed. Your own semiconductor
cooperation with Taiwan has genuinely deepened in the same window.
- Treasury: {{japan.treasury}} | Military power (SDF): {{japan.militaryPower}}
- Security alignment (with Taiwan/US) status: {{japan.securityAlignmentStatus}}
- Chip export control stance (toward China): {{japan.chipExportControlStance}}
- China blockade posture: {{china.blockadeStatus}} | China invasion posture: {{china.invasionStatus}}
- Status quo integrity: {{dealIntegrity}} / 100
- Diplomatic/gray-zone pressure (regional): {{proxyActivity}}
- Cross-strait stability: {{stability}}
- Conflict/incursion events last cycle: {{conflictEvents}}
- Trade volume: {{tradeVolume}}
- Cycle: {{cycle}}

News headlines this cycle:
{{newsHeadlines}}

### Quantum Belief State
{{japan.quantumNarrative}}

## How You Act

Decide what Japan actually does this cycle, in your own words — not a code from a fixed list. Diplomatic
(public status-quo support, quiet diplomacy with Beijing, Taiwan ties, invoking the US alliance),
economic/tech (chip export controls, economic security packages), military (SDF posture and role,
alliance consultation, Senkaku reinforcement), and domestic (Diet coalition signaling, pacifist opinion
management) levers are all in scope, but you are not limited to these categories — act as Japan's
leadership actually would given the real world state and headlines above, not from a pre-written menu.

## Output Format

Respond with a JSON object only. No prose outside the JSON.

{
  "primaryAction": "<a concrete, specific description of what Japan does this cycle — not a code, e.g. \"Quietly consult Washington on contingency planning while publicly maintaining a low profile\">",
  "supportingActions": ["<0-2 further concrete actions, same style>"],
  "reasoning": "<2-3 sentences in character: why this satisfies your coalition, fits your operational code, and reflects your risk frame>",
  "metricDeltas": {
    "stability": <integer -10 to +12>,
    "proxyActivity": <integer -20 to +15>,
    "tradeVolume": <integer -25 to +35>,
    "conflictEvents": <integer -3 to +4>,
    "dealIntegrity": <integer -10 to +12>,
    "reformPressure": <integer -8 to +10>
  },
  "chipExportControlStance": "<LOOSENING | STABLE | TIGHTENING>",
  "securityAlignmentStatus": "<ADVANCING | PAUSED | STALLED>",
  "coalitionSignal": "<SATISFIED | RESTLESS | CRISIS>",
  "researchNote": "<one sentence: which framework most explains this decision and why>"
}

Constraints:
- Don't move chipExportControlStance toward both LOOSENING and TIGHTENING signals in the same cycle — pick one direction.
- Don't simultaneously deepen AND pause Taiwan ties in the same cycle — pick one direction.
- If China's blockadeStatus = BLOCKADE or invasionStatus != NONE, your supportingActions must include a
  concrete US-alliance-consultation or Senkaku-reinforcement move.`,

}, // end taiwan-strait-2026

};


// ─────────────────────────────────────────────────────────────
// TEMPLATE FILLING
// ─────────────────────────────────────────────────────────────

// The nation agents reason from four IR-theory frameworks at once; that is a
// genuine reasoning task, so it runs on the flagship model with adaptive
// thinking rather than the smallest one. Kept in a constant because the
// pre-registration roadmap item (README) has to publish the exact model
// version a published run was produced with.
const AGENT_MODEL = "claude-opus-5";

// Effort shapes the output as much as the model id does — the same model at
// "low" and at "high" is not the same research instrument. Pinned next to the
// model, and recorded in a pre-registration for the same reason the model is.
// Note the operational cost of "high" here: a decision takes 9-12s wall clock,
// which is why vercel.json raises the serverless maxDuration to 60s.
const AGENT_EFFORT = "high";

// Structured outputs replace what used to be hand-rolled repair of the model's
// JSON (fence-stripping, and rewriting "+5" into "5"). Typing metricDeltas as
// integers is what makes the "+5" case impossible rather than patched.
//
// Schemas are per nation because each nation's prompt declares its own status
// vocabulary in its "## Output Format" block, and applyDecisions() reads those
// per-nation fields. The API rejects `additionalProperties: true`, so an open
// schema is not an option — every field a nation may emit has to be declared
// here. assertSchemasMatchPrompts() below fails fast at boot if the two drift.
const str = { type: "string" };
const enm = (...v) => ({ type: "string", enum: v });

function decisionSchema(deltaFields, extraProps) {
  const props = {
    primaryAction: str,
    supportingActions: { type: "array", items: str },
    reasoning: str,
    metricDeltas: {
      type: "object",
      properties: Object.fromEntries(deltaFields.map((f) => [f, { type: "integer" }])),
      required: deltaFields,
      additionalProperties: false,
    },
    ...extraProps,
    researchNote: str,
  };
  return {
    type: "object",
    properties: props,
    required: Object.keys(props),
    additionalProperties: false,
  };
}

const CORE_DELTAS = ["stability", "proxyActivity", "tradeVolume", "conflictEvents", "dealIntegrity"];
const COALITION = { coalitionSignal: enm("SATISFIED", "RESTLESS", "CRISIS") };

const DECISION_SCHEMAS = {
  "middle-east-2026": {
    iran: decisionSchema([...CORE_DELTAS, "hardlinerPressure"], {
      hormuzStatus: enm("OPEN", "THREATENED", "CLOSED"),
      nuclearStatus: enm("CAPPED", "PARTIAL_BREAKOUT", "FULL_BREAKOUT"),
      ...COALITION,
    }),
    israel: decisionSchema([...CORE_DELTAS, "publicSentiment"], {
      coalitionStatus: enm("STABLE", "STRAINED", "CRISIS"),
      existentialFrameActive: { type: "boolean" },
    }),
    saudi_arabia: decisionSchema([...CORE_DELTAS, "reformPressure"], {
      oilProductionStance: enm("INCREASING", "STABLE", "CUTTING"),
      normalizationStatus: enm("ADVANCING", "PAUSED", "STALLED"),
      ...COALITION,
    }),
    us: decisionSchema(["stability", "dealIntegrity", "tradeVolume", "publicSentiment", "diplomaticCapital"], {
      congressionalRatification: enm("PENDING", "RATIFIED", "BLOCKED"),
      ...COALITION,
    }),
  },
  "taiwan-strait-2026": {
    china: decisionSchema([...CORE_DELTAS, "hardlinerPressure"], {
      blockadeStatus: enm("OPEN", "QUARANTINE", "BLOCKADE"),
      invasionStatus: enm("NONE", "MOBILIZING", "LIMITED_STRIKE", "FULL_INVASION"),
      ...COALITION,
    }),
    taiwan: decisionSchema([...CORE_DELTAS, "publicSentiment"], {
      coalitionStatus: enm("STABLE", "STRAINED", "CRISIS"),
      existentialFrameActive: { type: "boolean" },
    }),
    japan: decisionSchema([...CORE_DELTAS, "reformPressure"], {
      chipExportControlStance: enm("LOOSENING", "STABLE", "TIGHTENING"),
      securityAlignmentStatus: enm("ADVANCING", "PAUSED", "STALLED"),
      ...COALITION,
    }),
  },
};

// The prompt is the contract the model actually sees; the schema is what the API
// enforces. If someone edits one and not the other the run fails in a confusing
// way mid-cycle, so check the top-level keys agree at boot instead.
function assertSchemasMatchPrompts() {
  for (const [scenarioId, nations] of Object.entries(DECISION_SCHEMAS)) {
    for (const [nation, schema] of Object.entries(nations)) {
      const prompt = SYSTEM_PROMPTS[scenarioId]?.[nation];
      if (!prompt) { console.warn(`[schema] no prompt for ${scenarioId}/${nation}`); continue; }
      const i = prompt.indexOf("## Output Format");
      if (i < 0) continue;
      const declared = [...prompt.slice(i, i + 1400).matchAll(/^  "([a-zA-Z]+)":/gm)].map((x) => x[1]);
      const missing = declared.filter((k) => !schema.properties[k]);
      const extra = Object.keys(schema.properties).filter((k) => !declared.includes(k));
      if (missing.length || extra.length) {
        console.warn(`[schema] ${scenarioId}/${nation} drift — prompt-only: [${missing}] schema-only: [${extra}]`);
      }
    }
  }
}

// Prompt caching is a prefix match, so a single live value interpolated near the
// top of a prompt invalidates everything after it. These prompts used to
// interleave world state through the framework sections, which made the whole
// system prompt uncacheable by construction. They are now split at the
// "## Current World State" heading: doctrine above it (frameworks, operational
// code, thresholds, output contract — byte-identical every cycle and every run),
// live situation below.
//
// Measured after the split (cache_creation_input_tokens on a cold call, then
// cache_read_input_tokens on the next): iran 1479, israel 1380, saudi_arabia
// 1498, us 1834, china 1721, taiwan 1435, japan 1720 — all seven clear the
// ~1024-token minimum and cache. That is roughly 55-60% of each request's input
// served at cache rates from the second cycle of a run onward. A static
// count_tokens estimate of the doctrine text alone under-reports this; trust
// the usage numbers on a real call, not the estimate.
//
// The split also separates publishable, version-pinnable doctrine from
// run-specific state, which is what the pre-registration roadmap item needs.
const SITUATION_HEADING = "## Current World State";

function splitPrompt(template, worldState) {
  const idx = template.indexOf(SITUATION_HEADING);
  if (idx < 0) {
    // No split point: fall back to one uncached block rather than guessing.
    return { doctrine: "", situation: fillTemplate(template, worldState) };
  }
  return {
    doctrine: template.slice(0, idx),
    situation: fillTemplate(template.slice(idx), worldState),
  };
}

function fillTemplate(template, worldState) {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const value = path.trim().split(".").reduce((obj, key) => obj?.[key], worldState);
    return value !== undefined ? String(value) : `{{${path}}}`;
  });
}


// ─────────────────────────────────────────────────────────────
// MOCK NEWS GENERATORS
// Headlines are scenario-aware: they react to world state. One
// generator per scenario (the actual headline text is inherently
// scenario-specific content, not something to templatize), dispatched
// by scenario id below.
// ─────────────────────────────────────────────────────────────

function generateHeadlinesMiddleEast(worldState) {
  const { stability, dealIntegrity, proxyActivity, cycle } = worldState;
  const { hormuzStatus, nuclearStatus, hardlinerPressure } = worldState.iran || {};

  const headlines = [];

  if (dealIntegrity < 20)
    headlines.push("BREAKING: Senior officials say peace deal is 'effectively dead'");
  else if (dealIntegrity < 40)
    headlines.push("Iran-Israel deal under severe strain as verification talks collapse");
  else if (dealIntegrity > 70)
    headlines.push("US envoy: Hormuz-Nuclear Agreement holding; verification talks progressing");

  if (hormuzStatus === "THREATENED")
    headlines.push("IRGC commander warns: 'Hormuz closure remains a legitimate option'");
  if (hormuzStatus === "CLOSED")
    headlines.push("BREAKING: Iran closes Hormuz Strait; oil prices surge 40% in Asian trading");

  if (nuclearStatus === "PARTIAL_BREAKOUT")
    headlines.push("IAEA: Iran enrichment detected above 20% threshold; emergency session called");
  if (nuclearStatus === "FULL_BREAKOUT")
    headlines.push("BREAKING: Iran announces full nuclear enrichment resumption; Israel puts military on high alert");

  if (proxyActivity > 70)
    headlines.push("Hezbollah launches cross-border strikes; Houthi missiles intercept Red Sea cargo");
  else if (proxyActivity > 50)
    headlines.push("Iranian-backed militias increase operations in Lebanon and Yemen");
  else if (proxyActivity < 25)
    headlines.push("Proxy violence at lowest level in five years as deal diplomacy continues");

  if (hardlinerPressure > 85)
    headlines.push("IRGC hardliners rally in Tehran: 'Moderates have betrayed the Revolution'");
  else if (hardlinerPressure > 70)
    headlines.push("Iranian parliament demands Supreme Leader reject further concessions on nuclear file");

  if (stability < 20)
    headlines.push("UN Security Council emergency session called as Middle East crisis deepens");
  else if (stability > 65)
    headlines.push("Regional trade volumes reach post-deal high; World Bank raises growth forecasts");

  if (worldState.saudiArabia?.normalizationStatus === "ADVANCING")
    headlines.push("Saudi-Israeli normalization: Crown Prince signals openness to 'historic breakthrough'");

  headlines.push(`Cycle ${cycle}: Regional diplomatic activity ${stability > 50 ? "continues at measured pace" : "intensifies amid rising tensions"}`);

  return headlines.slice(0, 4).join("\n");
}

function generateHeadlinesTaiwanStrait(worldState) {
  const { stability, dealIntegrity, proxyActivity, cycle } = worldState;
  const { blockadeStatus, invasionStatus, hardlinerPressure } = worldState.china || {};

  const headlines = [];

  if (dealIntegrity < 20)
    headlines.push("BREAKING: Analysts say cross-strait status quo has 'effectively collapsed'");
  else if (dealIntegrity < 40)
    headlines.push("Cross-strait status quo under severe strain as gray-zone incidents multiply");
  else if (dealIntegrity > 70)
    headlines.push("Cross-strait tensions ease; both sides signal continued adherence to the status quo");

  if (blockadeStatus === "GRAY_ZONE")
    headlines.push("PLA spokesperson: 'Quarantine measures remain a legitimate response option'");
  if (blockadeStatus === "BLOCKADE")
    headlines.push("BREAKING: China announces quarantine of Taiwan Strait shipping lanes; chip stocks plunge in Asian trading");

  if (invasionStatus === "LIMITED_STRIKE")
    headlines.push("Pentagon confirms limited PLA strikes on Taiwanese military installations; region on high alert");
  if (invasionStatus === "FULL_INVASION")
    headlines.push("BREAKING: PLA launches full invasion of Taiwan; US, Japan convene emergency security consultations");

  if (proxyActivity > 70)
    headlines.push("Median-line incursions reach record pace; Taiwanese and Japanese air forces scramble daily");
  else if (proxyActivity > 50)
    headlines.push("PLA gray-zone pressure and diplomatic maneuvering intensify across the region");
  else if (proxyActivity < 25)
    headlines.push("Gray-zone incidents at lowest level in years as cross-strait diplomacy continues");

  if (hardlinerPressure > 85)
    headlines.push("PLA hardliners rally domestic opinion: 'Reunification cannot wait indefinitely'");
  else if (hardlinerPressure > 70)
    headlines.push("Chinese state media demands 'concrete progress' toward reunification timeline");

  if (stability < 20)
    headlines.push("UN Security Council emergency session called as cross-strait crisis deepens");
  else if (stability > 65)
    headlines.push("Regional trade volumes reach post-tension high; chip markets stabilize");

  if (worldState.japan?.securityAlignmentStatus === "ADVANCING")
    headlines.push("Japan-Taiwan security cooperation: Tokyo signals openness to 'deepened alignment'");

  headlines.push(`Cycle ${cycle}: Cross-strait diplomatic activity ${stability > 50 ? "continues at measured pace" : "intensifies amid rising tensions"}`);

  return headlines.slice(0, 4).join("\n");
}

const HEADLINE_GENERATORS = {
  "middle-east-2026": generateHeadlinesMiddleEast,
  "taiwan-strait-2026": generateHeadlinesTaiwanStrait,
};

// The old behavior, kept as the fallback — see getHeadlines below and
// server/news.js's header comment for why this is no longer the primary
// path.
function generateMockHeadlines(scenarioId, worldState) {
  const gen = HEADLINE_GENERATORS[scenarioId];
  if (!gen) throw new Error(`Unknown scenario: ${scenarioId}`);
  return gen(worldState);
}

// Opus 5 rate card (per Anthropic's published pricing — update this if it
// changes; this is the only place it's hardcoded). Cache write/read
// multipliers (1.25x / 0.1x of the base input rate) are Anthropic's standard
// published ratios, not something specific to this model — Anthropic's own
// Console usage/billing page is the authority if these ever drift from what's
// coded here.
const OPUS5_PRICE_PER_MTOK = { input: 5, output: 25, cacheWrite: 5 * 1.25, cacheRead: 5 * 0.1 };

/**
 * There was no visibility into what a cycle actually costs before this —
 * `message.usage` was already threaded back to the client (see the
 * /api/agent/decide handler below) but nothing durable ever recorded it, so
 * "what does this cost to run" had no real answer, only a guess. This logs
 * one line per decision with the actual token counts and an estimated
 * dollar cost, so real cost-per-cycle can be read straight out of server
 * logs (`vercel logs` in production) instead of estimated from first
 * principles. Deliberately just a log line, not a database — this is a
 * measurement tool to inform a later real decision (rate limits, BYOK for
 * batch runs, etc.), not production cost-accounting infrastructure.
 */
function logAgentUsage(nation, scenarioId, cycle, model, usage) {
  if (!usage) return; // a fallback response or a shape we don't recognize — don't fabricate a number
  const { input_tokens = 0, output_tokens = 0, cache_creation_input_tokens = 0, cache_read_input_tokens = 0 } = usage;
  const price = model === AGENT_MODEL ? OPUS5_PRICE_PER_MTOK : null;
  const costUsd = price
    ? (input_tokens * price.input + output_tokens * price.output
        + cache_creation_input_tokens * price.cacheWrite + cache_read_input_tokens * price.cacheRead) / 1_000_000
    : null;
  console.log(
    `[usage] ${scenarioId}/${nation} cycle ${cycle} model=${model} ` +
    `in=${input_tokens} out=${output_tokens} cacheWrite=${cache_creation_input_tokens} cacheRead=${cache_read_input_tokens}` +
    (costUsd != null ? ` est=$${costUsd.toFixed(4)}` : model !== AGENT_MODEL ? " (fallback model — no price on file)" : "")
  );
}

/**
 * Real news first (server/news.js — GDELT, no key required, current
 * real-world Iran/Israel or China/Taiwan coverage); honest mock fallback
 * if GDELT is unreachable or returns nothing usable. `source` says which
 * one actually ran ("real-gdelt" | "mock-fallback") so nothing is
 * silently presented as real when it wasn't.
 */
async function getHeadlines(scenarioId, worldState) {
  try {
    const real = await fetchRealHeadlines(scenarioId);
    return { text: real.join("\n"), source: "real-gdelt" };
  } catch (err) {
    console.warn(`[news] real headlines unavailable for ${scenarioId} (${err.message}); using mock fallback`);
    return { text: generateMockHeadlines(scenarioId, worldState), source: "mock-fallback" };
  }
}


// ─────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────

/**
 * The actual decision call — pulled out of the /api/agent/decide route so
 * scripts/run-batch.js can drive it directly, in a loop, without a live
 * HTTP server in between. Throws (rather than ever returning an error
 * shape) so both the route below and a batch script get one code path to
 * handle failure, not two independently-maintained ones.
 */
async function decideNationAction({ nation, worldState, scenarioId }) {
  const scenarioPrompts = SYSTEM_PROMPTS[scenarioId];
  if (!scenarioPrompts) throw new Error(`Unknown or unsupported scenario: ${scenarioId}`);
  if (!scenarioPrompts[nation]) throw new Error(`Unknown nation "${nation}" for scenario "${scenarioId}"`);
  if (!DECISION_SCHEMAS[scenarioId]?.[nation]) throw new Error(`No output schema for "${nation}" in "${scenarioId}"`);

  const { text: headlines, source: newsSource } = await getHeadlines(scenarioId, worldState);
  const enrichedState = { ...worldState, newsHeadlines: headlines };
  const { doctrine, situation } = splitPrompt(scenarioPrompts[nation], enrichedState);

  const message = await anthropic.beta.messages.create({
    model: AGENT_MODEL,
    max_tokens: 8000,
    // A geopolitics simulation talks about strikes, blockades and breakout in
    // every prompt, so a safety decline is a live possibility rather than a
    // theoretical one. Server-side fallbacks re-run the same request on
    // another model inside the same call instead of failing the cycle. The
    // model that actually served is echoed back below — a run whose decisions
    // came from a fallback has to be able to say so.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: {
      effort: AGENT_EFFORT,
      format: { type: "json_schema", schema: DECISION_SCHEMAS[scenarioId][nation] },
    },
    system: [
      // Doctrine half: identical every cycle and every run, so it is the
      // cache prefix. See splitPrompt() for why the split point matters.
      { type: "text", text: doctrine, cache_control: { type: "ephemeral" } },
      // Situation half: changes every cycle, so it must come after the breakpoint.
      { type: "text", text: situation },
    ],
    messages: [
      {
        role: "user",
        content: `Cycle ${worldState.cycle}: Review the current world state above and make your decision.`,
      },
    ],
  });

  // If the whole fallback chain declined, say so plainly rather than failing
  // on a missing text block three lines down.
  if (message.stop_reason === "refusal") {
    const d = message.stop_details || {};
    throw new Error(`model declined this decision (category: ${d.category ?? "unknown"})`);
  }

  // Adaptive thinking means content[0] may be a thinking block, not the answer.
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("no text block in model response");
  // Structured outputs guarantee schema-valid JSON — no fence-stripping or
  // number-repair needed the way it was when this ran on a smaller model.
  const decision = JSON.parse(textBlock.text);
  logAgentUsage(nation, scenarioId, worldState.cycle, message.model, message.usage);

  return {
    nation,
    cycle: worldState.cycle,
    decision,
    // Which model actually produced this decision — normally AGENT_MODEL, but
    // a different one if a fallback served. Recorded per decision so a
    // published run can state its provenance rather than assume it.
    model: message.model,
    usage: message.usage,
    // "real-gdelt" | "mock-fallback" — see getHeadlines above. Recorded
    // for the same reason `model` is: a published run should be able to
    // say what actually grounded it, not assume.
    newsSource,
  };
}

app.post("/api/agent/decide", agentDecideLimiter, async (req, res) => {
  const { nation, worldState, scenarioId } = req.body;
  try {
    res.json(await decideNationAction({ nation, worldState, scenarioId }));
  } catch (err) {
    console.error(`[${nation}] agent error:`, err.message);
    const status = /Unknown|No output schema/.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});


app.get("/api/news", async (req, res) => {
  const { scenarioId, ...worldState } = req.query;
  if (!SYSTEM_PROMPTS[scenarioId]) {
    return res.status(400).json({ error: `Unknown or unsupported scenario: ${scenarioId}` });
  }
  const { text: headlines, source: newsSource } = await getHeadlines(scenarioId, worldState);
  res.json({ headlines, newsSource });
});


// Same files `node scripts/prereg.js verify-batch`/`list` read locally,
// bundled into the deployment (see vercel.json's `includeFiles`) so a
// visitor can view a batch's real hypothesis, config, and every trial's
// outcome without needing the repo checked out. Read-only, no batch can
// be started from here — see BatchResultsPage.jsx's own comment on why
// a real batch (hours of real trials) isn't a browser-triggerable flow
// the way a single "watch it play out" run is.
const PREREG_DIR = path.join(__dirname, "preregistrations");
function loadBatchFiles(hashPrefix) {
  const prefix = String(hashPrefix || "").slice(0, 16);
  const regFile = fs.readdirSync(PREREG_DIR).find((f) => f.startsWith(prefix) && f.endsWith(".registration.json"));
  if (!regFile) return null;
  const registration = JSON.parse(fs.readFileSync(path.join(PREREG_DIR, regFile), "utf8"));
  if (registration.kind !== "governance-playground/batch-preregistration") return null;
  const hash = hashRecord(registration);
  const resPath = path.join(PREREG_DIR, `${hash.slice(0, 16)}.result.json`);
  const result = fs.existsSync(resPath) ? JSON.parse(fs.readFileSync(resPath, "utf8")) : null;
  return { hash, registration, result };
}

app.get("/api/batch/:hashPrefix", async (req, res) => {
  try {
    const found = loadBatchFiles(req.params.hashPrefix);
    if (!found) return res.status(404).json({ error: `No batch registration found matching ${req.params.hashPrefix}` });
    const { hash, registration, result } = found;
    const report = result ? await verifyBatch({ registration, result }) : null;
    res.json({ hash, registration, result, report });
  } catch (err) {
    console.error("[batch] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Several batches side by side — e.g. one condition each, tested against
// the same baseline — for "which of these real alternatives is actually
// best," not just "is this one alternative different from baseline."
// Same underlying data/verification as /api/batch/:hashPrefix, just N of
// them in one response instead of one fetch per arm. A hash this list
// can't find is included with `error` set rather than dropped silently —
// a broken link in a comparison should be visible, not quietly absent.
app.get("/api/batch-compare", async (req, res) => {
  try {
    const prefixes = String(req.query.hashes || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (prefixes.length === 0) return res.status(400).json({ error: "?hashes=<hash1>,<hash2>,... is required" });
    const arms = await Promise.all(prefixes.map(async (prefix) => {
      const found = loadBatchFiles(prefix);
      if (!found) return { hashPrefix: prefix, error: `No batch registration found matching ${prefix}` };
      const { hash, registration, result } = found;
      const report = result ? await verifyBatch({ registration, result }) : null;
      return { hash, registration, result, report };
    }));
    res.json({ arms });
  } catch (err) {
    console.error("[batch-compare] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// Proxies to python-bridge/app.py — see that service's own README for
// what it does and its current (structurally-complete, not yet
// live-verified) status. This route's only job is forwarding the request
// and translating python-bridge being unreachable into a clear error,
// same "don't let this crash a governance cycle" standard as everything
// else quantum-flavored in this project.
app.post("/api/instinct/qpu-reading", qpuReadingLimiter, async (req, res) => {
  const { pressure, entangledReadout } = req.body;

  if (typeof pressure !== "number") {
    return res.status(400).json({ error: "pressure (number, 0-100) is required" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000); // real hardware queueing can take a while

  try {
    const response = await fetch(`${PYTHON_BRIDGE_URL}/qpu-reading`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pressure, entangledReadout }),
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(body);
    }
    res.json(body);
  } catch (err) {
    const reason = err.name === "AbortError" ? "python-bridge timed out after 30s" : `python-bridge unreachable: ${err.message}`;
    console.error("[instinct/qpu-reading]", reason);
    res.status(502).json({ error: reason, hint: "is python-bridge/app.py running? see python-bridge/README.md" });
  } finally {
    clearTimeout(timeout);
  }
});


// Higher stakes than /api/instinct/qpu-reading above: this feeds the
// actual committed political collapse (agents.js's
// evolveAndCollapseQuantumStateViaQPU) when the frontend's Tier 2 toggle
// is on, not a side-channel display. Same proxy shape otherwise —
// python-bridge unreachable is a clean 502, never a crash.
app.post("/api/layer1/qpu-collapse", qpuReadingLimiter, async (req, res) => {
  const { joint } = req.body;

  if (!Array.isArray(joint) || joint.length !== 4) {
    return res.status(400).json({ error: "joint must be an array of exactly 4 {re, im} amplitudes" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(`${PYTHON_BRIDGE_URL}/layer1-collapse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joint }),
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(body);
    }
    res.json(body);
  } catch (err) {
    const reason = err.name === "AbortError" ? "python-bridge timed out after 30s" : `python-bridge unreachable: ${err.message}`;
    console.error("[layer1/qpu-collapse]", reason);
    res.status(502).json({ error: reason, hint: "is python-bridge/app.py running? see python-bridge/README.md" });
  } finally {
    clearTimeout(timeout);
  }
});


app.get("/api/health", (_req, res) => res.json({ status: "ok" }));


// ─────────────────────────────────────────────────────────────
// NO-WALLET DEMO PATH
//
// Lets a visitor with no MetaMask, no Sepolia ETH, and no local Hardhat
// node get a real on-chain deployment anyway — server holds a dedicated,
// low-privilege demo key (DEMO_PRIVATE_KEY, separate from the deployer
// key behind the "real" citable Sepolia deployment) and signs on the
// visitor's behalf. See server/demoDeploy.js for why this is safe to
// expose publicly: it only ever runs one fixed sequence per known
// scenario id, never client-supplied bytecode/calldata — and, since the
// sequence runs one step per request now (below), why the in-flight
// state the client holds between requests is HMAC-sealed rather than
// trusted outright.
// ─────────────────────────────────────────────────────────────

const { getDemoStatus, runDeployStep, commitDemoCycle, sealState, verifySealedState } = require("./server/demoDeploy");

// Keep in sync with frontend/src/lib/cycleRunner.js's CYCLE_COUNT_OPTIONS —
// duplicated rather than shared for the same reason demoDeploy.js's own
// header comment gives for its ABI/deploy-logic duplication: this file is
// CommonJS, the frontend is ESM, and a 4-element array isn't worth a
// module-system workaround. Only used here to size the rate-limit skip
// check below and to word the error message for the request-shape check;
// the request-shape check itself accepts any totalCycles up to
// MAX_TOTAL_CYCLES, not just these four values — see that check's own
// comment for why.
const CYCLE_COUNT_OPTIONS = [1, 3, 5, 10];

// "Continue this run" (ConnectStep.jsx / LiveRunPanel.jsx's
// initialCheckpoint) resumes from whatever cycle a run left off at and
// asks the server to advance to `checkpoint.cycleIndex + <however many
// more the visitor picks>` — a value that isn't necessarily one of
// CYCLE_COUNT_OPTIONS (e.g. resuming from cycle 3 and picking "+5 more"
// asks the server for totalCycles: 8). totalCycles here was never a
// meaningful protocol constraint in the first place — the contract's own
// _advanceCycle() independently enforces the real limit against its own
// stored totalCycles, set once at deploy — so this is just a sanity
// bound on the request shape, generous enough to cover any realistic
// resume (comfortably above both scenarios' current 20-cycle default)
// without being unbounded.
const MAX_TOTAL_CYCLES = 50;

// Each deploy run is ~10-12 transactions split across that many step
// requests now (see /api/demo/deploy/step below) — this caps DEPLOY RUNS,
// not requests, so it still bounds how fast the funded demo wallet can be
// drained by one abusive IP without also making a single full run
// impossible. `skip` only counts stepIndex 0 (the start of a run); every
// continuation request for a run already in progress passes through free.
const demoDeployLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => (req.body?.stepIndex ?? 0) !== 0,
  message: { error: "Demo deploy rate limit reached (5/hour). Try again later, or connect your own wallet for unlimited use." },
});

app.get("/api/demo/status", async (_req, res) => {
  try {
    res.json(await getDemoStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One confirmed transaction per request, not the whole deploy — a full
// run is ~15-20 on-chain transactions over several minutes, and running
// that synchronously inside one Vercel serverless invocation is exactly
// what broke this originally: the platform kills the function long before
// it finishes and returns its own non-JSON timeout page, which is what
// produced the "Unexpected token 'A'..." error. The client drives the
// loop; each request here does one step and hands back HMAC-sealed state
// (see demoDeploy.js's sealState) for the client to echo back on the next
// one — no server-side session, so it works the same regardless of which
// Vercel instance picks up the next request.
app.post("/api/demo/deploy/step", demoDeployLimiter, async (req, res) => {
  const { scenarioId, stepIndex, mac, overrideIds } = req.body || {};
  if (!scenarioId || !Number.isInteger(stepIndex)) {
    return res.status(400).json({ error: "scenarioId and integer stepIndex required" });
  }
  // Step 0 starts a fresh run — any state the client sent is ignored, not
  // just unverified, so there's nothing to forge yet. Same reasoning
  // applies to overrideIds: it's only ever read from the request on step
  // 0 (see runDeployStep) — every later step gets it back out of the
  // already-verified, HMAC-sealed state instead, so it can't be swapped
  // mid-deploy. An unknown id inside the array isn't rejected here — see
  // applyStartingConditionOverrides's own comment on why that's safe:
  // that specific id is just skipped, not the whole deploy corrupted.
  // The shape itself (array of short strings) IS validated, since this
  // ends up as literal string[] calldata to bootstrapConfig — bounding
  // it keeps that call's calldata/gas trivial regardless of what a
  // client sends, independent of whether the ids inside resolve to
  // anything real.
  if (stepIndex === 0 && overrideIds !== undefined) {
    const shapeOk = Array.isArray(overrideIds) && overrideIds.length <= 10
      && overrideIds.every((id) => typeof id === "string" && id.length <= 60);
    if (!shapeOk) {
      return res.status(400).json({ error: "overrideIds must be an array of up to 10 strings, each at most 60 characters" });
    }
  }
  const state = stepIndex === 0 ? {} : req.body?.state || {};
  if (JSON.stringify(state).length > 20_000) {
    return res.status(400).json({ error: "state payload too large" });
  }
  if (stepIndex > 0 && !verifySealedState(scenarioId, stepIndex, state, mac)) {
    return res.status(400).json({ error: "Invalid or tampered deploy state — start a new deploy." });
  }
  try {
    const out = await runDeployStep(scenarioId, stepIndex, state, undefined, overrideIds);
    const sealed = sealState(scenarioId, out.stepIndex + 1, out.state);
    // On the final deploy step, also mint a run-phase seal (cycleIndex 0,
    // its own namespace) bound to the registry that just came out of
    // deployment — the bridge into /api/demo/commit-cycle below, so the
    // client can go straight from "deployed" to "watch it play out"
    // without a second round trip just to get a starting seal.
    const run = out.done
      ? sealState(scenarioId, 0, { registryAddress: out.state.registryAddress }, "run")
      : null;
    res.json({
      stepIndex: out.stepIndex,
      totalSteps: out.totalSteps,
      label: out.label,
      txHash: out.txHash,
      done: out.done,
      state: sealed.state,
      mac: sealed.mac,
      result: out.result,
      runState: run?.state,
      runMac: run?.mac,
    });
  } catch (err) {
    console.error("[demo/deploy/step] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Each deploy comes with its own fresh, isolated on-chain instance, so
// this caps how many full RUNS a visitor can start, same shape as
// demoDeployLimiter above — `skip` only counts cycleIndex 0.
const demoRunLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  // `runStart` (set by LiveRunPanel.jsx) marks the one request per drive-
  // loop invocation that corresponds to a visitor actually clicking "run
  // N cycles" — every other request in that same loop is a continuation
  // of an action already counted, not a new one. This used to check
  // cycleIndex === 0, which broke the moment "Continue this run" shipped:
  // a resumed run's first request is never cycle 0, so every resumed
  // cycle would have skipped the rate limit entirely.
  skip: (req) => !req.body?.runStart,
  message: { error: "Demo run rate limit reached (5/hour). Try again later, or connect your own wallet for unlimited use." },
});

// Signs and sends ONE cycle's commitCycle() transaction. Everything that
// produces the metrics being committed — agent decisions, quantum
// collapse, market resolution — already happened in the visitor's own
// browser with no wallet involved (frontend/src/lib/cycleRunner.js's
// runAutonomousCycle, which calls the already-walletless /api/agent/decide
// under the hood); this is only the one piece a no-wallet visitor's
// browser structurally cannot do itself. See commitDemoCycle's own header
// comment on why `metrics` is clamped but not independently re-verified —
// same trust boundary MetaMask already has in the wallet-connected flow.
// Independently re-caps and re-shapes the client's decisions/summary
// payload before it's ever handed to a signer — the client-side caps in
// cycleRunner.js are a courtesy (smaller request, lower gas), not a
// security boundary. A malformed or hostile payload here fails the
// request rather than reaching commitCycleWithNarrative() with garbage
// types (calldata string args, so a non-string would revert at the ABI
// encoding step anyway, but failing fast with a clear 400 is better than
// an opaque ethers encoding error).
const CHAIN_FIELD_MAX = 600;
const MAX_DECISIONS_PER_CYCLE = 12; // generous over the largest scenario's nation count

function sanitizeChainString(v) {
  if (typeof v !== "string") return "";
  return v.length > CHAIN_FIELD_MAX ? v.slice(0, CHAIN_FIELD_MAX) : v;
}

// Returns `null` (meaning: fall back to the plain commitCycle path) when
// the client sent nothing narrative-shaped at all — decisions is the
// signal field: an omitted or non-array `decisions` means "no narrative
// this call", not "narrative with zero decisions" (which IS valid and
// preserved as an empty array, e.g. every agent call errored this cycle).
function sanitizeNarrative(body) {
  if (!Array.isArray(body?.decisions)) return null;
  if (body.decisions.length > MAX_DECISIONS_PER_CYCLE) {
    throw new Error(`Too many decisions in one cycle (max ${MAX_DECISIONS_PER_CYCLE})`);
  }
  const decisions = body.decisions.map((d) => ({
    nationId: sanitizeChainString(d?.nationId).slice(0, 60),
    primaryAction: sanitizeChainString(d?.primaryAction),
    reasoning: sanitizeChainString(d?.reasoning),
    researchNote: sanitizeChainString(d?.researchNote),
  }));
  return {
    decisions,
    quantumSummary: sanitizeChainString(body?.quantumSummary),
    marketSummary: sanitizeChainString(body?.marketSummary),
  };
}

app.post("/api/demo/commit-cycle", demoRunLimiter, async (req, res) => {
  const { scenarioId, cycleIndex, totalCycles, mac, metrics } = req.body || {};
  if (!scenarioId || !Number.isInteger(cycleIndex) || !Number.isInteger(totalCycles) || totalCycles < 1 || totalCycles > MAX_TOTAL_CYCLES) {
    return res.status(400).json({ error: `scenarioId, integer cycleIndex, and integer totalCycles in [1, ${MAX_TOTAL_CYCLES}] required` });
  }
  if (cycleIndex < 0 || cycleIndex >= totalCycles) {
    return res.status(400).json({ error: "cycleIndex out of range for totalCycles" });
  }
  const state = req.body?.state || {};
  if (JSON.stringify(state).length > 2_000) {
    return res.status(400).json({ error: "state payload too large" });
  }
  if (!verifySealedState(scenarioId, cycleIndex, state, mac, "run")) {
    return res.status(400).json({ error: "Invalid or tampered run state — start a new deploy." });
  }
  let narrative;
  try {
    narrative = sanitizeNarrative(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    const out = await commitDemoCycle(state.registryAddress, metrics, narrative);
    const done = cycleIndex === totalCycles - 1;
    const sealed = sealState(scenarioId, cycleIndex + 1, state, "run");
    res.json({
      cycleIndex,
      totalCycles,
      txHash: out.txHash,
      metrics: out.metrics,
      currentCycleOnChain: out.currentCycle,
      simulationActive: out.simulationActive,
      done,
      state: sealed.state,
      mac: sealed.mac,
    });
  } catch (err) {
    console.error("[demo/commit-cycle] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// ─────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────

// Only actually bind a port when run directly (`node server.js` / `npm run
// server`). When Vercel's Node runtime instead requires() this file as a
// serverless function (see api/index.js), it wants the bare Express app to
// hand a request/response pair to itself — calling listen() here too would
// be harmless but pointless in that context, so skip it.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Governance Playground agent server running on http://localhost:${PORT}`);
    console.log(`Nation agents: ${AGENT_MODEL} (adaptive thinking, structured outputs)`);
    assertSchemasMatchPrompts();
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn("WARNING: ANTHROPIC_API_KEY is not set. /api/agent/decide will fail.");
    }
  });
}

module.exports = app;

// Exposed for scripts/prereg.js: a pre-registration has to hash the exact
// doctrine text and decision schemas a run will use, so they have to be
// readable from outside this file without standing the server up.
module.exports.agentContract = {
  AGENT_MODEL,
  AGENT_EFFORT,
  SYSTEM_PROMPTS,
  DECISION_SCHEMAS,
  SITUATION_HEADING,
  // Exported so scripts/run-batch.js can drive real decisions directly, in
  // a loop, without a live HTTP server in between — same function the
  // /api/agent/decide route itself calls, not a second implementation.
  decideNationAction,
  doctrineOf(scenarioId) {
    const nations = SYSTEM_PROMPTS[scenarioId];
    if (!nations) throw new Error(`Unknown scenario: ${scenarioId}`);
    return Object.fromEntries(
      Object.entries(nations).map(([n, tpl]) => {
        const i = tpl.indexOf(SITUATION_HEADING);
        return [n, i < 0 ? tpl : tpl.slice(0, i)];
      }),
    );
  },
};

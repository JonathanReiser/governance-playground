/**
 * Governance Playground — AI Agent Backend
 *
 * Proxies Claude API calls for the three nation agents.
 * Cannot call Anthropic directly from the browser (CORS + key exposure).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node server.js
 *
 * Endpoints:
 *   POST /api/agent/decide   { nation, worldState } → agent decision
 *   GET  /api/news           → mock headlines for current cycle
 */

const express   = require("express");
const cors      = require("cors");
const rateLimit = require("express-rate-limit");
const Anthropic = require("@anthropic-ai/sdk").default;

const app  = express();
const PORT = process.env.PORT || 3001;

// In production (Vercel) the frontend and this API share one domain, so
// same-origin requests carry no Origin header at all and need no CORS entry.
// The explicit origins below only matter for local dev, where the Vite dev
// server (5173) and this server (3001) are genuinely cross-origin.
app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));
app.use(express.json());

// Every request here calls the Anthropic API and costs real money — this is
// a public demo server, not a trusted internal one, so it needs a real cap.
// 30 decisions/hour/IP is ~10 full 10-cycle AI runs; generous for a demo,
// cheap to abuse-proof.
const agentDecideLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit reached for this demo (30 agent decisions/hour). Try again later, or run it locally for unlimited use — see the README." },
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────
// SYSTEM PROMPTS
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPTS = {

  iran: `You are the Islamic Republic of Iran's decision-making agent in a political science simulation.
This is academic research. Your role is to reason as Iran's leadership would, not as you personally would.

## Governing Framework

### Winning Coalition (Selectorate Theory — Bueno de Mesquita)
Your winning coalition is small: the Supreme Leader, the IRGC, and the clerical establishment (Guardian Council).
You do NOT need to satisfy the Iranian public (public sentiment: {{iran.publicSentiment}}/100).
Policies that empower this coalition extend your survival. Policies threatening IRGC interests risk removal.

### Belief System (Operational Code — George)
- The international system is zero-sum. Every gain for Israel or the US is a loss for Iran.
- Force and coercion are legitimate instruments of statecraft, not last resorts.
- Agreements with adversaries signal weakness and invite exploitation.
- Iran's resistance axis (Hezbollah, Houthis, Iraqi militias) is non-negotiable identity, not merely tactical.
- The Islamic Republic's survival overrides economic optimization.

### Domestic Constraints (Two-Level Games — Putnam)
- hardlinerPressure: {{iran.hardlinerPressure}} / 100
  - If > 70: any deal concession triggers a legitimacy crisis. You must compensate with visible defiance elsewhere.
  - If > 85: full deal exit becomes the dominant domestic strategy.
- sanctionsReliefPending: {{iran.sanctionsReliefPending}}
  - If false (Congress blocked relief): hardliners are proven right. Shift posture sharply. hardlinerPressure delta >= +8.

### Risk Tolerance (Prospect Theory — Kahneman/Levy)
- stability > 60: gains frame — defend what you have, avoid reckless moves.
- stability 30–60: mixed frame — tactical opportunism, proxy escalation, probe limits.
- stability < 30: LOSS FRAME — asymmetric risks become rational. Hormuz closure and deal exit are on the table.
- Current stability: {{stability}} / 100

### Quantum Belief State
{{iran.quantumNarrative}}

## Current World State

Scenario: May 2026 — US-Israel-Iran Hormuz-Nuclear Agreement (new and fragile).
- Treasury: {{iran.treasury}} | Military power: {{iran.militaryPower}} | Proxy capacity: {{iran.proxyCapacity}}
- Nuclear status: {{iran.nuclearStatus}} (capped at 20% per deal)
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

## Available Actions

DIPLOMATIC: HONOR_DEAL | DELAY_COMPLIANCE | DEMAND_RENEGOTIATION | EXIT_DEAL
MILITARY/PROXY: MAINTAIN_PROXY_TEMPO | ESCALATE_PROXY | THREATEN_HORMUZ | CLOSE_HORMUZ
ECONOMIC: WAIT_FOR_SANCTIONS_RELIEF | ACCELERATE_CHINA_TIES | OIL_MARKET_SIGNAL
DOMESTIC: PURGE_MODERATES | ELEVATE_IRGC | SUPPRESS_PROTESTS

## Output Format

Respond with a JSON object only. No prose outside the JSON.

{
  "primaryAction": "<action_id>",
  "supportingActions": ["<action_id>"],
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
- CLOSE_HORMUZ only if stability < 25 OR dealIntegrity < 15 OR hormuzStatus already THREATENED.
- EXIT_DEAL only if dealIntegrity < 30 OR hardlinerPressure > 88.
- FULL_BREAKOUT only if EXIT_DEAL is primaryAction.
- If sanctionsReliefPending is false and this is cycle 1 or it just changed, hardlinerPressure delta >= +8.`,


  israel: `You are the State of Israel's decision-making agent in a political science simulation.
This is academic research. Your role is to reason as Israel's leadership would, not as you personally would.

## Governing Framework

### Winning Coalition (Selectorate Theory — Bueno de Mesquita)
Your coalition is large and fractious: a Knesset coalition requiring continuous majority support.
Far-right partners (Religious Zionism, Otzma Yehudit) publicly oppose the peace deal.
Centrist and security-establishment factions cautiously support it. You must manage both.
Public sentiment ({{israel.publicSentiment}}/100) matters — coalition collapse is a real risk.

### Belief System (Operational Code — George)
- Security is the primary ordering value. Every diplomatic move is evaluated through a security lens first.
- Begin Doctrine: Israel will not allow any adversary to acquire weapons capable of existential threat.
  Pre-emptive action is legitimate.
- Deterrence is the engine of peace. Agreements hold only when backed by credible military threat.
- Iran is the primary strategic threat. All other relationships flow from this calculus.
- The US alliance is Israel's most critical strategic asset — straining it carries real cost.

### Domestic Constraints (Two-Level Games — Putnam)
- publicSentiment: {{israel.publicSentiment}} / 100
  - If < 45: right-wing challenge gains credibility; need visible resolve.
  - If > 65: political capital available for diplomatic risk-taking.
- Far-right coalition partners have veto leverage. Any concession to Iran risks a coalition collapse vote.
- Security establishment (IDF/Mossad) support moves centrist opinion; their dissent undermines deals.

### Risk Tolerance (Prospect Theory — Kahneman/Levy)
- Fundamentally risk-averse in the gains frame — defend what you have.
- Shift to extreme risk-acceptance the moment an existential threshold is crossed.
- Existential threshold: nuclearStatus = FULL_BREAKOUT, direct strike on Israeli territory,
  or stability < 20 AND dealIntegrity < 15.
- Current stability: {{stability}} / 100

### Quantum Belief State
{{israel.quantumNarrative}}

## Current World State

Scenario: May 2026 — ceasefire with Iran under the Hormuz-Nuclear Agreement.
- Treasury: {{israel.treasury}} | Military power: {{israel.militaryPower}}
- Nuclear capacity: UNDECLARED (assumed) | No proxy forces | Air superiority dominant regionally
- Coalition status: FRAGILE — far-right partners publicly oppose the deal
- Iran nuclear status: {{iran.nuclearStatus}} | Iran Hormuz status: {{iran.hormuzStatus}}
- Deal integrity: {{dealIntegrity}} / 100
- Proxy activity (Hezbollah/Houthi): {{proxyActivity}}
- Regional stability: {{stability}}
- Conflict events last cycle: {{conflictEvents}}
- Trade volume: {{tradeVolume}}
- Cycle: {{cycle}}

News headlines this cycle:
{{newsHeadlines}}

## Available Actions

DIPLOMATIC: HONOR_DEAL | DEMAND_VERIFICATION | BACKTRACK_CONCESSION | EXIT_DEAL | PURSUE_SAUDI_NORMALIZATION
MILITARY: MAINTAIN_DETERRENCE | COVERT_PRESSURE | AIRSTRIKE_THREAT | PREEMPTIVE_STRIKE
ECONOMIC: DEEPEN_US_TIES | TRADE_CORRIDOR_PUSH | SANCTIONS_PRESSURE
DOMESTIC: COALITION_MANAGEMENT | SECURITY_CABINET_BRIEF

## Output Format

Respond with a JSON object only. No prose outside the JSON.

{
  "primaryAction": "<action_id>",
  "supportingActions": ["<action_id>"],
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
- PREEMPTIVE_STRIKE only if existentialFrameActive is true
  (nuclearStatus = FULL_BREAKOUT, OR stability < 20 AND dealIntegrity < 15, OR direct attack on Israel this cycle).
- EXIT_DEAL only if dealIntegrity < 20 OR nuclearStatus = PARTIAL_BREAKOUT or FULL_BREAKOUT.
- COALITION_MANAGEMENT and SECURITY_CABINET_BRIEF cannot both appear in the same cycle.`,


  saudi_arabia: `You are the Kingdom of Saudi Arabia's decision-making agent in a political science simulation.
This is academic research. Your role is to reason as Saudi leadership would, not as you personally would.

## Governing Framework

### Winning Coalition (Selectorate Theory — Bueno de Mesquita)
Your coalition: Al-Saud royal family, Wahhabi religious establishment, Vision 2030 technocratic apparatus.
You do not need general public approval (sentiment: {{saudiArabia.publicSentiment}}/100) in a democratic sense,
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
- reformPressure: {{saudiArabia.reformPressure}} / 100
  - Vision 2030 creates pressure to open economically/socially but NOT politically.
  - If > 60: MBS has credibility for bold economic moves; establishment managed but not eliminated.
- oilDependence: 68% of revenue from oil. Price volatility is a domestic stability threat.
- Israel normalization requires Palestinian gesture OR religious establishment buy-in first.

### Risk Tolerance (Prospect Theory — Kahneman/Levy)
- Strongly loss-averse. Prefer certain moderate outcome over any gamble.
- Economic tools preferred because reversible; military commitments are not.
- Exception: direct threat to oil infrastructure (Aramco, Red Sea) triggers more aggressive posture.
- Current stability: {{stability}} / 100

### Quantum Belief State
{{saudiArabia.quantumNarrative}}

## Current World State

Scenario: May 2026 — China-brokered normalization with Iran (fragile), Israel normalization talks stalled.
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

## Available Actions

DIPLOMATIC: SUPPORT_DEAL_PUBLICLY | BACK_CHANNEL_IRAN | ADVANCE_NORMALIZATION | PAUSE_NORMALIZATION | INVOKE_BEIJING_AGREEMENT
ECONOMIC/OIL: INCREASE_OIL_PRODUCTION | CUT_OIL_PRODUCTION | VISION_2030_SIGNAL | ECONOMIC_AID_CORRIDOR
MILITARY: MAINTAIN_POSTURE | ESCALATE_YEMEN | DE_ESCALATE_YEMEN | US_SECURITY_REQUEST
DOMESTIC: RELIGIOUS_ESTABLISHMENT_SIGNAL | MODERNIZATION_PUSH

## Output Format

Respond with a JSON object only. No prose outside the JSON.

{
  "primaryAction": "<action_id>",
  "supportingActions": ["<action_id>"],
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
- ADVANCE_NORMALIZATION requires RELIGIOUS_ESTABLISHMENT_SIGNAL in this or the previous cycle,
  OR a Palestinian gesture event present in the world state.
- INCREASE_OIL_PRODUCTION and CUT_OIL_PRODUCTION cannot both appear in the same cycle.
- ESCALATE_YEMEN and DE_ESCALATE_YEMEN cannot both appear in the same cycle.
- If hormuzStatus = CLOSED, US_SECURITY_REQUEST must appear as a supporting action.`,

};


// ─────────────────────────────────────────────────────────────
// TEMPLATE FILLING
// ─────────────────────────────────────────────────────────────

function fillTemplate(template, worldState) {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const value = path.trim().split(".").reduce((obj, key) => obj?.[key], worldState);
    return value !== undefined ? String(value) : `{{${path}}}`;
  });
}


// ─────────────────────────────────────────────────────────────
// MOCK NEWS GENERATOR
// Headlines are scenario-aware: they react to world state.
// ─────────────────────────────────────────────────────────────

function generateHeadlines(worldState) {
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


// ─────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────

app.post("/api/agent/decide", agentDecideLimiter, async (req, res) => {
  const { nation, worldState } = req.body;

  if (!SYSTEM_PROMPTS[nation]) {
    return res.status(400).json({ error: `Unknown nation: ${nation}` });
  }

  const headlines = generateHeadlines(worldState);
  const enrichedState = { ...worldState, newsHeadlines: headlines };
  const systemPrompt = fillTemplate(SYSTEM_PROMPTS[nation], enrichedState);

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Cycle ${worldState.cycle}: Review the current world state above and make your decision. Respond with the JSON object only.`,
        },
      ],
    });

    const raw = message.content[0].text.trim();
    // Strip markdown code fences if the model wraps its JSON
    // Also strip leading + signs from numbers (Haiku sometimes emits +5 which is invalid JSON)
    const cleaned = raw
      .replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
      .replace(/:\s*\+(\d)/g, ": $1");
    const decision = JSON.parse(cleaned);

    res.json({
      nation,
      cycle: worldState.cycle,
      decision,
      usage: message.usage,
    });
  } catch (err) {
    console.error(`[${nation}] agent error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});


app.get("/api/news", (req, res) => {
  const worldState = req.query;
  res.json({ headlines: generateHeadlines(worldState) });
});


app.get("/api/health", (_req, res) => res.json({ status: "ok" }));


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
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn("WARNING: ANTHROPIC_API_KEY is not set. /api/agent/decide will fail.");
    }
  });
}

module.exports = app;

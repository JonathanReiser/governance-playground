/**
 * GOVERNANCE PLAYGROUND
 * Scenario: Middle East — 2026
 *
 * This config represents the geopolitical state of the Middle East
 * as of May 2026, following the US/Israel-Iran peace deal.
 *
 * Every parameter is cited. Every number is adjustable.
 * If you disagree with a value — fork this file, change it,
 * and run your own experiment.
 *
 * Sources:
 *   - Freedom House 2026 (governance scores)
 *   - World Bank 2026 (economic data)
 *   - SIPRI 2026 (military expenditure)
 *   - ACLED 2026 (conflict event data)
 *   - Arab Barometer Wave 7 (public sentiment)
 *   - EIA 2026 (energy/oil data)
 */

const MIDDLE_EAST_2026 = {

  // ─────────────────────────────────────────────
  // SCENARIO METADATA
  // ─────────────────────────────────────────────

  meta: {
    name: "Middle East — May 2026",
    version: "1.0.0",
    description:
      "Post-war scenario following the US/Israel-Iran peace deal. " +
      "Iran has agreed to cap nuclear enrichment and reopen the Hormuz Strait. " +
      "The US has lifted partial sanctions. Regional stability is fragile.",
    tags: ["middle-east", "peace-deal", "nuclear", "hormuz", "2026"],
    suggestedExperiments: [
      "What if the peace deal collapses in year 1?",
      "What if US Congress blocks sanctions relief?",
      "What if Saudi Arabia formally normalizes with Israel?",
      "What if Iran's hardliners gain domestic power?",
    ],
    // The AI Agent Cycle mode (Claude-driven nation agents + the quantum
    // uncertainty engine) is currently hardcoded to this scenario's specific
    // nations — real IR-theory system prompts for Iran/Israel/Saudi Arabia,
    // an Iran/Israel entangled pair, a Middle-East-specific economic field
    // (oil/rial/riyal/US gas). Classic Experiments mode is scenario-agnostic;
    // AI mode is not, yet. See frontend/src/lib/agents.js, markets.js, and
    // server.js's SYSTEM_PROMPTS.
    aiModeSupported: true,
  },


  // ─────────────────────────────────────────────
  // RESOURCES
  // Units are relative (0–100 scale)
  // They represent leverage and contestation,
  // not exact real-world quantities
  // ─────────────────────────────────────────────

  resources: [
    {
      id: "oil",
      name: "Oil Reserves",
      description: "Petroleum production capacity and reserves",
      source: "EIA International Energy Statistics 2026",
      contestable: true,
    },
    {
      id: "water",
      name: "Water Rights",
      description: "Access to rivers, aquifers, and water infrastructure",
      source: "UN Water Report 2025",
      contestable: true,
    },
    {
      id: "treasury",
      name: "Treasury",
      description: "Economic wealth available for governance and action",
      source: "World Bank GDP Data 2026",
      contestable: false,
    },
  ],


  // ─────────────────────────────────────────────
  // NATIONS
  // ─────────────────────────────────────────────

  nations: [

    // ── ISRAEL ──────────────────────────────────
    {
      id: "israel",
      name: "Israel",
      flag: "🇮🇱",

      governance: {
        type: "PARLIAMENTARY_DEMOCRACY",
        description:
          "Multi-party parliamentary system. Requires coalition " +
          "majorities. High citizen participation. No formal constitution.",
        source: "Freedom House 2026 — Score: 76/100",

        proposalThreshold: 100,   // low — any citizen can propose
        quorum: 40,               // 40% must vote
        votingMechanism: "ONE_TOKEN_ONE_VOTE",
        coalitionRequired: true,  // need majority coalition to pass
        vetoCouncil: false,
        guardianVeto: false,
        royalVeto: false,
      },

      economy: {
        treasury: 8500,
        source: "World Bank — Israel GDP $525B (2026)",
        sanctioned: false,
        tradeOpenness: "HIGH",
      },

      military: {
        power: 850,
        source: "SIPRI 2026 — $23.6B military expenditure",
        range: [800, 920],
        nuclearCapacity: true,    // undeclared but assumed
        proxyForces: false,
      },

      resources: {
        oil: 5,                   // minimal domestic reserves
        water: 30,                // contested — Jordan River, aquifers
        source: "EIA 2026, UN Water 2025",
      },

      population: {
        size: "MEDIUM",           // 9.7 million
        sentiment: 58,            // public trust in government (0–100)
        source: "Arab Barometer Wave 7 / Pew Research 2026",
      },
    },


    // ── IRAN ────────────────────────────────────
    {
      id: "iran",
      name: "Iran",
      flag: "🇮🇷",

      governance: {
        type: "THEOCRATIC_REPUBLIC",
        description:
          "Dual-layer system. Citizens vote for president and parliament " +
          "but the Supreme Leader and Guardian Council hold veto power " +
          "over all legislation and candidate eligibility.",
        source: "Freedom House 2026 — Score: 14/100",

        proposalThreshold: 5000,  // high — few can propose
        quorum: 20,               // low — easy to pass with small turnout
        votingMechanism: "DUAL_LAYER",
        coalitionRequired: false,
        vetoCouncil: false,
        guardianVeto: true,       // clerical council can override any vote
        royalVeto: false,

        hardlinerPressure: 72,    // internal pressure to act aggressively
        source_hardliner: "V-Dem Dataset 2026",
      },

      economy: {
        treasury: 4200,
        source: "World Bank — Iran GDP ~$401B (sanctions-reduced, 2026)",
        sanctioned: true,         // partial sanctions remain post-deal
        sanctionsReliefPending: true,
        tradeOpenness: "LOW",
      },

      military: {
        power: 620,
        source: "SIPRI 2026 — est. $10B military expenditure",
        range: [580, 740],        // wide range — estimates are contested
        nuclearCapacity: false,   // capped under peace deal
        nuclearDealActive: true,
        proxyForces: true,        // Hezbollah, Houthis, Iraqi militias
        proxyCapacity: 85,        // HIGH proxy reach across region
      },

      resources: {
        oil: 80,                  // 2nd largest reserves in OPEC
        water: 25,
        source: "EIA 2026",
        hormuzControl: true,      // can threaten strait closure
        hormuzOpen: true,         // currently open — per peace deal
      },

      population: {
        size: "LARGE",            // 87 million
        sentiment: 29,            // low public trust — economic hardship
        source: "IranPoll 2026, Arab Barometer Wave 7",
      },
    },


    // ── SAUDI ARABIA ────────────────────────────
    {
      id: "saudi_arabia",
      name: "Saudi Arabia",
      flag: "🇸🇦",

      governance: {
        type: "ABSOLUTE_MONARCHY",
        description:
          "Power concentrated in the royal family (Al Saud). " +
          "Council of Ministers appointed by the King. " +
          "No elected national legislature. Vision 2030 reform program " +
          "ongoing but political opening is limited.",
        source: "Freedom House 2026 — Score: 8/100",

        proposalThreshold: 50000, // very high — royal council only
        quorum: 10,               // tiny — council can act easily
        votingMechanism: "COUNCIL_WEIGHTED",
        coalitionRequired: false,
        vetoCouncil: false,
        guardianVeto: false,
        royalVeto: true,          // king can override anything

        reformPressure: 55,       // Vision 2030 modernization incentive
        source_reform: "Economist Intelligence Unit 2026",
      },

      economy: {
        treasury: 18000,
        source: "World Bank — Saudi GDP $1.06T (2026)",
        sanctioned: false,
        tradeOpenness: "MEDIUM",
        oilDependence: 0.68,      // 68% of revenue from oil
      },

      military: {
        power: 720,
        source: "SIPRI 2026 — $75B military expenditure",
        range: [600, 750],        // high spending, contested effectiveness
        nuclearCapacity: false,
        proxyForces: true,        // backing anti-Houthi forces in Yemen
        proxyCapacity: 45,
      },

      resources: {
        oil: 95,                  // largest proven reserves globally
        water: 15,                // severe water scarcity
        source: "EIA 2026, UN Water 2025",
      },

      population: {
        size: "MEDIUM",           // 35 million
        sentiment: 62,
        source: "Arab Barometer Wave 7 / YouGov Middle East 2026",
      },
    },

  ],


  // ─────────────────────────────────────────────
  // RELATIONSHIPS
  // ─────────────────────────────────────────────

  relationships: [
    {
      from: "israel",
      to: "iran",
      type: "FRAGILE_PEACE",
      description:
        "Active hostility transformed by the 2026 peace deal. " +
        "Deep mutual distrust remains. Deal is under strain from " +
        "Israeli hardliners and Iranian Revolutionary Guard elements.",
      source: "Reuters, AP — May 2026",
      stabilityScore: 28,         // how likely this holds (0–100)
      treatyActive: true,
      treatyName: "US-brokered Hormuz-Nuclear Agreement 2026",
    },
    {
      from: "israel",
      to: "saudi_arabia",
      type: "COLD",
      description:
        "No formal diplomatic relations. Back-channel cooperation " +
        "on Iran containment exists. Normalization talks stalled.",
      source: "Foreign Affairs, May 2026",
      stabilityScore: 55,
      treatyActive: false,
      normalizationTalksActive: true,
    },
    {
      from: "iran",
      to: "saudi_arabia",
      type: "FRAGILE_PEACE",
      description:
        "China-brokered normalization from 2023 holding but strained. " +
        "Proxy conflicts in Yemen and Lebanon create ongoing friction.",
      source: "Crisis Group Middle East Report 2026",
      stabilityScore: 42,
      treatyActive: true,
      treatyName: "Beijing Agreement 2023",
    },
  ],


  // ─────────────────────────────────────────────
  // ACTIVE EVENTS
  // ─────────────────────────────────────────────

  activeEvents: [
    {
      id: "hormuz_nuclear_deal",
      name: "US-Israel-Iran Peace Deal",
      type: "PEACE_DEAL",
      status: "ACTIVE_FRAGILE",
      parties: ["israel", "iran"],
      externalGuarantor: "US",
      description:
        "Iran agrees to cap nuclear enrichment and keep Hormuz Strait open. " +
        "US lifts partial sanctions. Israel agrees to ceasefire. " +
        "Deal is new and untested — spoiler risk is high on both sides.",
      terms: [
        "Iran: nuclear enrichment capped at 20% (civilian threshold)",
        "Iran: Hormuz Strait remains open to international shipping",
        "US: partial sanctions relief on Iranian oil exports",
        "Israel: ceasefire — no offensive strikes on Iranian territory",
      ],
      vulnerabilities: [
        "No verification mechanism agreed yet",
        "US Congress has not ratified sanctions relief",
        "Iranian Revolutionary Guard not party to deal",
        "Israeli far-right coalition partners publicly oppose deal",
      ],
      source: "Reuters, BBC, Al Jazeera — May 2026",
    },
    {
      id: "hormuz_status",
      name: "Hormuz Strait Status",
      type: "RESOURCE_EVENT",
      status: "OPEN",
      controlledBy: "iran",
      description:
        "Strait is currently open following the peace deal. " +
        "20% of global oil supply passes through this chokepoint. " +
        "Iran retains the legal and physical ability to close it.",
      economicImpact: "HIGH",
    },
  ],


  // ─────────────────────────────────────────────
  // SIMULATION PARAMETERS
  // ─────────────────────────────────────────────

  simulation: {
    defaultCycles: 20,
    cycleDescription: "Each cycle represents approximately 1 month",

    metrics: [
      {
        id: "stability_index",
        name: "Regional Stability Index",
        description: "Overall measure of peaceful governance (0–100)",
        startingValue: 38,        // fragile — post-war, new deal
      },
      {
        id: "conflict_events",
        name: "Conflict Events",
        description: "Number of hostile cross-DAO actions per cycle",
        startingValue: 3,
      },
      {
        id: "trade_volume",
        name: "Trade Volume",
        description: "Economic exchange between nations",
        startingValue: 120,       // reduced — sanctions partially lifted
      },
      {
        id: "proxy_activity",
        name: "Proxy Activity",
        description: "Cross-border faction funding and operations",
        startingValue: 45,
      },
      {
        id: "deal_integrity",
        name: "Peace Deal Integrity",
        description: "Likelihood the current peace deal holds (0–100)",
        startingValue: 52,        // coin flip — new and untested
      },
    ],
  },


  // ─────────────────────────────────────────────
  // SUGGESTED EXPERIMENTS
  // ─────────────────────────────────────────────

  experiments: [
    {
      id: "exp_deal_collapse",
      name: "The Deal Collapses",
      question: "What happens if the peace deal collapses in cycle 1?",
      change: {
        target: "activeEvents.hormuz_nuclear_deal.status",
        from: "ACTIVE_FRAGILE",
        to: "COLLAPSED",
      },
      effects: { stability: { delta: -18 }, dealIntegrity: { set: 0 }, conflicts: { delta: 4 }, proxy: { delta: 20 }, dealActive: false },
      hypothesis:
        "Iran closes Hormuz within 3 cycles. " +
        "Oil prices spike. Saudi Arabia faces pressure. " +
        "Stability index drops below 20.",
      hypothesisChecks: [
        { label: "Hormuz closure impact (trade dropped >40%)", metric: "trade", op: "belowPctOfBaseline", value: 60 },
        { label: "Stability dropped below 20", metric: "stability", op: "below", value: 20 },
        { label: "Proxy activity surged >15 pts", metric: "proxy", op: "aboveBaselinePlus", value: 15 },
        { label: "Hormuz closure cycles (trade <50)", metric: "trade", op: "cyclesBelow", value: 50 },
      ],
    },
    {
      id: "exp_congress_blocks",
      name: "US Congress Blocks Sanctions Relief",
      question: "What if the US fails to deliver on its sanctions promise?",
      change: {
        target: "nations.iran.economy.sanctionsReliefPending",
        from: true,
        to: false,
        additionalChange: {
          target: "nations.iran.economy.sanctioned",
          value: true,
        },
      },
      effects: { dealIntegrity: { delta: -25 }, proxy: { delta: 10 } },
      hypothesis:
        "Iran's hardliner pressure increases. " +
        "Deal integrity drops. " +
        "Proxy activity resumes within 5 cycles.",
      hypothesisChecks: [
        { label: "Deal integrity deteriorated >15 pts", metric: "dealIntegrity", op: "belowBaselineMinus", value: 15 },
        { label: "Hardliner pressure rose (proxy >+8)", metric: "proxy", op: "aboveBaselinePlus", value: 8 },
        { label: "Proxy activity resumed within 5 cycles", metric: "proxy", op: "aboveWithinFirstNCycles", value: 50, n: 5 },
        { label: "Deal fully collapsed", metric: "dealIntegrity", op: "equals", value: 0 },
      ],
    },
    {
      id: "exp_saudi_normalizes",
      name: "Saudi Arabia Normalizes with Israel",
      question: "What if Saudi Arabia formally recognizes Israel?",
      change: {
        target: "relationships.israel_saudi.type",
        from: "COLD",
        to: "PARTNER",
      },
      effects: { trade: { delta: 200 }, stability: { delta: 12 }, proxy: { delta: 8 } },
      hypothesis:
        "Regional trade increases significantly. " +
        "Iran feels encircled — hardliner pressure rises. " +
        "Palestinian DAO loses leverage.",
      hypothesisChecks: [
        { label: "Trade increased >150", metric: "trade", op: "aboveBaselinePlus", value: 150 },
        { label: "Iran hardliner response (proxy rose)", metric: "proxy", op: "aboveBaselinePlus", value: 5 },
        { label: "Net stability gain", metric: "stability", op: "aboveBaselinePlus", value: 0 },
        { label: "Trade and stability both up (dual win)", op: "and", refs: [0, 2] },
      ],
    },
    {
      id: "exp_hardliners_win",
      name: "Iranian Hardliners Gain Power",
      question: "What if hardliners replace moderates in Iran's government?",
      change: {
        target: "nations.iran.governance.hardlinerPressure",
        from: 72,
        to: 95,
      },
      effects: { dealIntegrity: { delta: -35 }, proxy: { delta: 25 }, stability: { delta: -10 }, isHardlinerEvent: true },
      hypothesis:
        "Iran exits the nuclear deal. " +
        "Hormuz threatened within 4 cycles. " +
        "Proxy activity surges to maximum.",
      hypothesisChecks: [
        { label: "Iran exits nuclear deal (integrity → 0)", metric: "dealIntegrity", op: "equals", value: 0 },
        { label: "Proxy activity surged to max >80", metric: "proxy", op: "above", value: 80 },
        { label: "Hormuz threatened (cycles below 50 trade)", metric: "trade", op: "cyclesBelow", value: 50 },
        { label: "Significant stability drop >15 pts", metric: "stability", op: "belowBaselineMinus", value: 15 },
      ],
    },
  ],


  // ─────────────────────────────────────────────
  // CITIZEN TOKEN DISTRIBUTION
  // Data-driven per nation — no hardcoded nation IDs in the deploy
  // scripts; see scripts/deploy.js / frontend/src/lib/contracts.js.
  // Slot indices reference signers[0..5]: 0 = deployer/researcher,
  // 1 = guardian-council-style role, 2 = royal/override-style role,
  // 3-5 = population segments.
  // ─────────────────────────────────────────────

  citizenDistribution: {
    israel:       [ { slot: 0, amount: 200000 }, { slot: 3, amount: 500000 }, { slot: 4, amount: 200000 }, { slot: 5, amount: 100000 } ],
    iran:         [ { slot: 0, amount: 100000 }, { slot: 3, amount: 300000 }, { slot: 4, amount: 500000 }, { slot: 5, amount: 100000 } ],
    saudi_arabia: [ { slot: 2, amount: 800000 }, { slot: 3, amount: 150000 }, { slot: 5, amount: 50000  } ],
  },

}

module.exports = MIDDLE_EAST_2026

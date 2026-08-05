/**
 * GOVERNANCE PLAYGROUND
 * Scenario: Taiwan Strait — 2026
 *
 * This config represents an escalated cross-strait tension scenario as of
 * 2026, following intensified PLA military exercises near Taiwan and a
 * contested Taiwanese presidential transition. The decades-old "status quo"
 * ambiguity — maintained since 1979 by the US Taiwan Relations Act and
 * since 2005 by China's Anti-Secession Law, without ever being resolved by
 * a signed agreement — faces its most serious test since the 1995-96
 * missile crisis.
 *
 * Every parameter is cited or reasoned from named methodology. Every number
 * is adjustable. If you disagree with a value — fork this file, change it,
 * and run your own experiment.
 *
 * NOTE ON UNITS: treasury/military figures are relative units for
 * comparison *within this scenario* (China/Taiwan/Japan to each other),
 * not literal dollar or personnel counts — same convention as
 * middle-east-2026.config.cjs. Real GDP/military-spending ratios between
 * these three nations are vastly larger than anything in the Middle East
 * scenario (China's economy alone is ~30x Israel's), so linear real-dollar
 * scaling would break the existing 0–1000ish display range this app was
 * built around. Rank order and rough proportion are preserved; absolute
 * scale is compressed.
 *
 * NOTE ON GOVERNANCE TYPE: the on-chain GovernanceType enum
 * (PARLIAMENTARY_DEMOCRACY / THEOCRATIC_REPUBLIC / ABSOLUTE_MONARCHY /
 * FEDERAL_REPUBLIC / MILITARY_JUNTA) was built around the Middle East
 * scenario's three systems and doesn't have a clean slot for China's
 * actual system (a unitary single-party socialist state). FEDERAL_REPUBLIC
 * is used here as the least-wrong available label — it's the only option
 * that triggers neither of the two governance-type-gated contract behaviors
 * (ABSOLUTE_MONARCHY's royal-authority-only foreign policy gate,
 * THEOCRATIC_REPUBLIC's high-hardliner treaty block), which don't match
 * China's actual dynamics anyway. China's real concentration of power is
 * instead represented honestly through the fully generic fields:
 * COUNCIL_WEIGHTED voting, a very high proposal threshold, low quorum, and
 * royalVeto repurposed to represent Politburo Standing Committee override
 * authority — the same underlying mechanic (one body can override
 * everything) generalizes cleanly even though the label doesn't.
 *
 * Sources:
 *   - Freedom House (governance scores)
 *   - World Bank (GDP data)
 *   - SIPRI (military expenditure)
 *   - Taiwan Relations Act (1979), China's Anti-Secession Law (2005)
 *   - CSIS China Power Project, IISS Military Balance
 */

const TAIWAN_STRAIT_2026 = {

  // ─────────────────────────────────────────────
  // SCENARIO METADATA
  // ─────────────────────────────────────────────

  meta: {
    name: "Taiwan Strait — 2026",
    version: "1.0.0",
    description:
      "Escalated cross-strait tension scenario following intensified PLA " +
      "military exercises near Taiwan and a contested Taiwanese presidential " +
      "transition. The decades-old 'status quo' ambiguity — never a signed " +
      "peace, just mutual deterrence — faces its most serious test since 1996.",
    tags: ["taiwan-strait", "cross-strait", "semiconductors", "one-china", "2026"],
    suggestedExperiments: [
      "What if China formally abandons the status quo?",
      "What if the US ends strategic ambiguity?",
      "What if Japan deepens security ties with Taiwan?",
      "What if PLA hardliners gain dominant influence over Taiwan policy?",
    ],
  },


  // ─────────────────────────────────────────────
  // RESOURCES
  // ─────────────────────────────────────────────

  resources: [
    {
      id: "semiconductors",
      name: "Advanced Semiconductor Fabrication",
      description: "Leading-edge chip manufacturing capacity",
      source: "TSMC 2026 capacity reports, CSIS China Power Project",
      contestable: true,
    },
    {
      id: "shipping_lanes",
      name: "Taiwan Strait Shipping Lanes",
      description: "Commercial shipping and undersea cable routes through the strait",
      source: "IMF/World Bank global trade flow data",
      contestable: true,
    },
    {
      id: "treasury",
      name: "Treasury",
      description: "Economic wealth available for governance and action (relative units — see scenario header note)",
      source: "World Bank GDP data",
      contestable: false,
    },
  ],


  // ─────────────────────────────────────────────
  // NATIONS
  // ─────────────────────────────────────────────

  nations: [

    // ── CHINA (PRC) ─────────────────────────────
    {
      id: "china",
      name: "China",
      flag: "🇨🇳",

      governance: {
        type: "FEDERAL_REPUBLIC",  // see header note — imperfect fit, least-wrong available label
        description:
          "Unitary single-party state under the Chinese Communist Party. " +
          "Power concentrated in the Politburo Standing Committee; the " +
          "National People's Congress ratifies rather than deliberates. " +
          "No meaningful political opposition.",
        source: "Freedom House 2024 — Score: 9/100 (Not Free)",

        proposalThreshold: 50000,   // very high — only top party organs propose
        quorum: 15,                 // low — passes easily once proposed by the right body
        votingMechanism: "COUNCIL_WEIGHTED",
        coalitionRequired: false,
        vetoCouncil: false,
        guardianVeto: false,
        royalVeto: true,            // repurposed: Politburo Standing Committee override

        hardlinerPressure: 78,      // PLA / nationalist pressure for "reunification"
        source_hardliner: "CSIS China Power Project 2026 assessment",
      },

      economy: {
        treasury: 22000,
        source: "World Bank — China GDP ~$17.9T (2023); compressed to this scenario's relative unit scale, see header note",
        sanctioned: false,
        tradeOpenness: "MEDIUM",
      },

      military: {
        power: 920,
        source: "SIPRI 2023 — ~$296B military expenditure (largest after the US)",
        range: [850, 980],
        nuclearCapacity: true,
        proxyForces: false,
      },

      resources: {
        semiconductors: 10,          // negligible domestic leading-edge capacity
        shipping_lanes: 60,          // major stakeholder but doesn't control the strait
        source: "CSIS China Power Project 2026",
      },

      population: {
        size: "LARGE",               // 1.41 billion
        sentiment: 61,                // state-managed nationalism runs high on this issue
        source: "CSIS/Pew Global Attitudes 2026 estimate",
      },
    },


    // ── TAIWAN (ROC) ────────────────────────────
    {
      id: "taiwan",
      name: "Taiwan",
      flag: "🇹🇼",

      governance: {
        type: "PARLIAMENTARY_DEMOCRACY",
        description:
          "Semi-presidential multi-party democracy. President and " +
          "Legislative Yuan directly elected. High citizen participation. " +
          "No formal mutual-defense treaty with any external power.",
        source: "Freedom House 2024 — Score: 94/100 (Free)",

        proposalThreshold: 150,
        quorum: 35,
        votingMechanism: "ONE_TOKEN_ONE_VOTE",
        coalitionRequired: true,
        vetoCouncil: false,
        guardianVeto: false,
        royalVeto: false,

        hardlinerPressure: 40,      // domestic pro-independence vs. status-quo tension
        source_hardliner: "Taiwan National Security Survey 2026 (Duke/NCCU)",
      },

      economy: {
        treasury: 6500,
        source: "World Bank — Taiwan GDP ~$790B (2023); compressed to this scenario's relative unit scale, see header note",
        sanctioned: false,
        tradeOpenness: "HIGH",
      },

      military: {
        power: 340,
        source: "SIPRI 2023 — ~$19B military expenditure",
        range: [300, 380],
        nuclearCapacity: false,
        proxyForces: false,
      },

      resources: {
        semiconductors: 92,          // TSMC — ~90%+ of leading-edge global fabrication
        shipping_lanes: 55,          // controls the strait's eastern approach
        source: "TSMC 2026 capacity reports",
      },

      population: {
        size: "MEDIUM",              // 23.6 million
        sentiment: 66,
        source: "Taiwan National Security Survey 2026 (Duke/NCCU)",
      },
    },


    // ── JAPAN ───────────────────────────────────
    {
      id: "japan",
      name: "Japan",
      flag: "🇯🇵",

      governance: {
        type: "PARLIAMENTARY_DEMOCRACY",
        description:
          "Constitutional monarchy with a parliamentary system. National " +
          "Diet elected; Self-Defense Forces constitutionally constrained " +
          "but expanding role under evolving security doctrine.",
        source: "Freedom House 2024 — Score: 96/100 (Free)",

        proposalThreshold: 200,
        quorum: 40,
        votingMechanism: "ONE_TOKEN_ONE_VOTE",
        coalitionRequired: true,
        vetoCouncil: false,
        guardianVeto: false,
        royalVeto: false,

        reformPressure: 58,          // pressure toward deeper US/Taiwan security alignment
        source_reform: "IISS Military Balance 2026 assessment",
      },

      economy: {
        treasury: 9500,
        source: "World Bank — Japan GDP ~$4.2T (2023); compressed to this scenario's relative unit scale, see header note",
        sanctioned: false,
        tradeOpenness: "HIGH",
      },

      military: {
        power: 480,
        source: "SIPRI 2023 — ~$50B military expenditure",
        range: [430, 540],
        nuclearCapacity: false,
        proxyForces: false,
      },

      resources: {
        semiconductors: 25,           // materials/equipment supply chain, not fabrication itself
        shipping_lanes: 35,           // Yonaguni/Senkaku proximity, own strait-adjacent stakes
        source: "IISS Military Balance 2026, CSIS China Power Project",
      },

      population: {
        size: "LARGE",                 // 124 million
        sentiment: 54,
        source: "Pew Global Attitudes 2026 estimate",
      },
    },

  ],


  // ─────────────────────────────────────────────
  // RELATIONSHIPS
  // ─────────────────────────────────────────────

  relationships: [
    {
      from: "china",
      to: "taiwan",
      type: "COLD",
      description:
        "No formal diplomatic relations. China considers Taiwan a renegade " +
        "province, not a separate state. Frequent PLA median-line incursions " +
        "and gray-zone pressure short of open conflict.",
      source: "CSIS China Power Project, IISS 2026",
      stabilityScore: 22,
      treatyActive: false,
      treatyName: "",
    },
    {
      from: "china",
      to: "japan",
      type: "COLD",
      description:
        "Deep economic interdependence alongside real security tension — " +
        "East China Sea disputes, Senkaku/Diaoyu proximity, historical " +
        "grievances. Neither partnership nor open hostility.",
      source: "IISS Military Balance 2026",
      stabilityScore: 38,
      treatyActive: false,
      treatyName: "",
    },
    {
      from: "taiwan",
      to: "japan",
      type: "COLD",
      description:
        "No formal diplomatic relations (Japan recognized only the PRC " +
        "after 1972 normalization) but substantive informal economic and " +
        "quasi-security cooperation, sharpened by Japan's own proximity " +
        "stakes in a Taiwan Strait crisis.",
      source: "IISS Military Balance 2026, CSIS 2026",
      stabilityScore: 65,
      treatyActive: false,
      treatyName: "",
    },
  ],


  // ─────────────────────────────────────────────
  // ACTIVE EVENTS
  // ─────────────────────────────────────────────

  activeEvents: [
    {
      id: "cross_strait_status_quo",
      name: "Cross-Strait Status Quo",
      type: "PEACE_DEAL",   // structural analog, not a literal signed peace — see description
      status: "ACTIVE_FRAGILE",
      parties: ["china", "taiwan"],
      externalGuarantor: "US",
      description:
        "Decades-old ambiguous arrangement maintained by mutual deterrence, " +
        "not a signed agreement: the US Taiwan Relations Act (1979) commits " +
        "to Taiwan's defensive capacity without a mutual-defense treaty; " +
        "China's Anti-Secession Law (2005) authorizes 'non-peaceful means' " +
        "if Taiwan formally declares independence. Both sides tolerate the " +
        "ambiguity because the alternative — resolving it — is worse for " +
        "everyone.",
      terms: [
        "China: refrains from military invasion so long as Taiwan doesn't declare formal independence",
        "Taiwan: maintains de facto independence without a formal declaration",
        "US: maintains 'strategic ambiguity' — supplies defensive arms, no mutual-defense treaty",
      ],
      vulnerabilities: [
        "No verification mechanism — the arrangement rests entirely on mutual restraint",
        "PLA capability and exercise tempo near Taiwan has grown sharply",
        "Taiwanese public opinion trends away from unification over time",
        "US strategic ambiguity itself is domestically contested",
      ],
      source: "US Taiwan Relations Act 1979, China Anti-Secession Law 2005, CSIS 2026",
    },
    {
      id: "semiconductor_chokepoint",
      name: "Taiwan Strait Semiconductor Chokepoint",
      type: "RESOURCE_EVENT",
      status: "OPEN",
      controlledBy: "taiwan",
      description:
        "Taiwan produces the overwhelming majority of the world's most " +
        "advanced semiconductors. A blockade or conflict would disrupt " +
        "global chip supply chains more severely than any single oil " +
        "chokepoint disruption in modern history.",
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
        name: "Cross-Strait Stability Index",
        description: "Overall measure of peaceful status-quo maintenance (0–100)",
        startingValue: 40,
      },
      {
        id: "conflict_events",
        name: "Conflict Events",
        description: "Gray-zone incidents — median-line incursions, air/sea provocations",
        startingValue: 2,
      },
      {
        id: "trade_volume",
        name: "Trade Volume",
        description: "Economic exchange between the three nations",
        startingValue: 340,
      },
      {
        id: "proxy_activity",
        name: "Proxy Activity",
        description: "Third-party pressure and diplomatic maneuvering (regional analog of proxy conflict)",
        startingValue: 25,
      },
      {
        id: "deal_integrity",
        name: "Status Quo Integrity",
        description: "Likelihood the current ambiguous arrangement holds (0–100)",
        startingValue: 48,
      },
    ],
  },


  // ─────────────────────────────────────────────
  // CITIZEN TOKEN DISTRIBUTION
  // Data-driven per nation — no hardcoded nation IDs in the deploy
  // scripts; see scripts/deploy.js / frontend/src/lib/contracts.js.
  // Slot indices reference signers[0..5]: 0 = deployer/researcher,
  // 1 = guardian-council-style role, 2 = royal/override-style role,
  // 3-5 = population segments.
  // ─────────────────────────────────────────────

  citizenDistribution: {
    china:  [ { slot: 0, amount: 100000 }, { slot: 2, amount: 700000 }, { slot: 3, amount: 200000 } ],
    taiwan: [ { slot: 0, amount: 150000 }, { slot: 3, amount: 400000 }, { slot: 4, amount: 300000 }, { slot: 5, amount: 150000 } ],
    japan:  [ { slot: 0, amount: 150000 }, { slot: 3, amount: 450000 }, { slot: 4, amount: 250000 }, { slot: 5, amount: 150000 } ],
  },


  // ─────────────────────────────────────────────
  // SUGGESTED EXPERIMENTS
  // Data-driven effects + hypothesisChecks — see frontend/src/lib/
  // simulation.js and frontend/src/components/ResultsStep.jsx, which
  // interpret these generically instead of branching on experiment id.
  // ─────────────────────────────────────────────

  experiments: [
    {
      id: "exp_status_quo_collapses",
      name: "The Status Quo Collapses",
      question: "What happens if China formally abandons the status quo?",
      change: {
        target: "activeEvents.cross_strait_status_quo.status",
        from: "ACTIVE_FRAGILE",
        to: "COLLAPSED",
      },
      effects: { stability: { delta: -18 }, dealIntegrity: { set: 0 }, conflicts: { delta: 4 }, proxy: { delta: 20 }, dealActive: false },
      hypothesis:
        "Trade collapses within 3 cycles. Conflict events surge. " +
        "Stability index drops below 20.",
      hypothesisChecks: [
        { label: "Trade dropped >40%", metric: "trade", op: "belowPctOfBaseline", value: 60 },
        { label: "Stability dropped below 20", metric: "stability", op: "below", value: 20 },
        { label: "Proxy activity surged >15 pts", metric: "proxy", op: "aboveBaselinePlus", value: 15 },
        { label: "Trade collapse cycles (trade <100)", metric: "trade", op: "cyclesBelow", value: 100 },
      ],
    },
    {
      id: "exp_ambiguity_ends",
      name: "US Strategic Ambiguity Ends",
      question: "What if the US formally commits to Taiwan's defense?",
      change: {
        target: "nations.china.governance.hardlinerPressure",
        from: 78,
        to: 90,
      },
      effects: { dealIntegrity: { delta: -15 }, proxy: { delta: 8 }, stability: { delta: -5 } },
      hypothesis:
        "China's hardliner pressure spikes further. Status quo integrity " +
        "drops. Proxy/diplomatic pressure resumes within 5 cycles.",
      hypothesisChecks: [
        { label: "Status quo integrity deteriorated >15 pts", metric: "dealIntegrity", op: "belowBaselineMinus", value: 15 },
        { label: "Hardliner-adjacent pressure rose (proxy >+8)", metric: "proxy", op: "aboveBaselinePlus", value: 8 },
        { label: "Proxy activity resumed within 5 cycles", metric: "proxy", op: "aboveWithinFirstNCycles", value: 50, n: 5 },
        { label: "Status quo fully collapsed", metric: "dealIntegrity", op: "equals", value: 0 },
      ],
    },
    {
      id: "exp_japan_deepens_ties",
      name: "Japan Deepens Security Ties with Taiwan",
      question: "What if Japan formally deepens defense cooperation with Taiwan?",
      change: {
        target: "relationships.taiwan_japan.type",
        from: "COLD",
        to: "PARTNER",
      },
      effects: { trade: { delta: 150 }, proxy: { delta: 5 }, stability: { delta: 6 } },
      hypothesis:
        "Regional trade increases significantly. China feels encircled — " +
        "hardliner pressure rises. Net stability effect is positive but " +
        "not free.",
      hypothesisChecks: [
        { label: "Trade increased >150", metric: "trade", op: "aboveBaselinePlus", value: 150 },
        { label: "China's pressure response (proxy rose)", metric: "proxy", op: "aboveBaselinePlus", value: 5 },
        { label: "Net stability gain", metric: "stability", op: "aboveBaselinePlus", value: 0 },
        { label: "Trade and stability both up (dual win)", op: "and", refs: [0, 2] },
      ],
    },
    {
      id: "exp_pla_hardliners_win",
      name: "PLA Hardliners Gain Dominant Influence",
      question: "What if PLA hardliners gain dominant influence over China's Taiwan policy?",
      change: {
        target: "nations.china.governance.hardlinerPressure",
        from: 78,
        to: 95,
      },
      effects: { dealIntegrity: { delta: -35 }, proxy: { delta: 25 }, stability: { delta: -10 }, isHardlinerEvent: true },
      hypothesis:
        "The status quo effectively ends. Gray-zone pressure surges to " +
        "near-maximum within a few cycles. Substantial stability drop.",
      hypothesisChecks: [
        { label: "Status quo effectively ends (integrity → 0)", metric: "dealIntegrity", op: "equals", value: 0 },
        { label: "Proxy/gray-zone activity surged to max >80", metric: "proxy", op: "above", value: 80 },
        { label: "Trade disruption cycles (trade <150)", metric: "trade", op: "cyclesBelow", value: 150 },
        { label: "Significant stability drop >15 pts", metric: "stability", op: "belowBaselineMinus", value: 15 },
      ],
    },
  ],

}

module.exports = TAIWAN_STRAIT_2026

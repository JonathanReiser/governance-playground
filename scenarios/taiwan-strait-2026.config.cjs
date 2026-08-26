/**
 * GOVERNANCE PLAYGROUND
 * Scenario: Taiwan Strait — 2026
 *
 * BASELINE AS OF: 2026-08-26 (v2.0.0 — re-baselined; see CHANGELOG below)
 *
 * This config represents cross-strait tension as of mid-2026: a real May
 * 14-15, 2026 Trump-Xi summit that produced no substantive agreement on
 * the status quo, a $14B Taiwan arms package (announced January 2026)
 * still delayed by the White House, and real, dated escalation between
 * China and Japan specifically (a January 2026 Chinese ban on dual-use
 * exports to Japanese military end-users, after remarks on Taiwan by PM
 * Sanae Takaichi) — alongside PLA exercise tempo that has actually
 * reverted toward its pre-2024 baseline rather than continuing to climb.
 * The decades-old "status quo" ambiguity — maintained since 1979 by the
 * US Taiwan Relations Act and since 2005 by China's Anti-Secession Law,
 * without ever being resolved by a signed agreement — is genuinely
 * unresolved, not necessarily acutely escalating on every axis at once.
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
 *   - Global Taiwan Institute, "How Taiwan Fared during the 2026
 *     Trump-Xi Summit" (May 2026)
 *   - Al Jazeera / CNN, May 14-15, 2026 Trump-Xi summit coverage
 *   - Taiwan Ministry of National Defense, PLA activity reports around
 *     Taiwan (August 2, 2026 and August 21, 2026)
 *   - Taiwan Security Monitor, PLA Activity Center — sortie-volume trend
 *     since the start of 2026
 *   - "China Bans Dual-Use Tech Exports to Japan Military Over Taiwan
 *     Remarks" (January 2026 reporting)
 *   - Taiwan News, "Taiwan-Japan supply chains become security strategy"
 *     (July 22, 2026); Kumamoto-Kaohsiung-Arizona semiconductor MOU
 *     (March 2026)
 *   - East Asia Forum, "US chip export controls have cooled down"
 *     (March 2026)
 *
 * CHANGELOG (v1.0.0 -> v2.0.0, 2026-08-26):
 * The original baseline described intensifying PLA exercises building
 * toward "the most serious test since 1996." Real reporting since doesn't
 * support that trajectory on the military axis specifically: sortie
 * volume, which had doubled after President Lai's 2024 inauguration,
 * reverted toward its pre-Lai baseline starting in 2026 (Taiwan MND daily
 * reports: single-digit sorties in early-to-mid August 2026, some days
 * with zero PLA aircraft detected). What IS real and newly acute is
 * diplomatic and economic, not military: a Trump-Xi summit happened
 * (May 14-15, 2026) and settled nothing — Xi warned missteps on Taiwan
 * could mean "conflict," and Trump's own posture on the long-delayed $14B
 * arms package was ambiguous rather than reassuring. Separately, China
 * escalated concretely against Japan specifically (the January 2026
 * dual-use export ban), while Taiwan-Japan cooperation has deepened
 * concretely in the same window (the March 2026 Kumamoto-Kaohsiung-
 * Arizona semiconductor MOU). Numbers below marked "reasoned estimate"
 * are an interpretation of these cited real events into this simulation's
 * 0-100 scale, not a claim that a specific poll or index produced this
 * exact figure — same practice the original baseline already used.
 */

const TAIWAN_STRAIT_2026 = {

  // ─────────────────────────────────────────────
  // SCENARIO METADATA
  // ─────────────────────────────────────────────

  meta: {
    id: "taiwan-strait-2026",
    name: "Taiwan Strait — 2026",
    version: "2.0.0",
    baselineAsOf: "2026-08-26",
    description:
      "Cross-strait tension scenario as of mid-2026: a real Trump-Xi summit (May 2026) that " +
      "settled nothing on the status quo, a long-delayed $14B Taiwan arms package, and real " +
      "China-Japan escalation over Taiwan remarks — alongside PLA exercise tempo that has " +
      "actually eased back toward its pre-2024 baseline rather than continuing to climb. The " +
      "decades-old 'status quo' ambiguity — never a signed peace, just mutual deterrence — " +
      "remains genuinely unresolved, unevenly across its diplomatic, economic, and military axes.",
    tags: ["taiwan-strait", "cross-strait", "semiconductors", "one-china", "2026"],
    suggestedExperiments: [
      "What if China formally abandons the status quo?",
      "What if the US finally delivers the delayed arms package?",
      "What if Japan deepens security ties with Taiwan?",
      "What if PLA hardliners gain dominant influence over Taiwan policy?",
    ],
    // The AI Agent Cycle mode (Claude-driven nation agents + the quantum
    // uncertainty engine) reads its IR-theory system prompts, entanglement
    // pairing, and economic-field instruments from this scenario's own
    // `aiAgents` config block below — see frontend/src/lib/agents.js,
    // markets.js, and server.js's SYSTEM_PROMPTS (all keyed by meta.id).
    aiModeSupported: true,
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
      color: "#dc2626",

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

        hardlinerPressure: 74,      // reasoned estimate, down slightly from the prior baseline (78) —
                                     // real May 2026 summit diplomacy stayed assertive (Xi's "conflict"
                                     // warning) but real PLA sortie tempo has eased toward its pre-2024
                                     // baseline, not continued climbing; net effect is a modest reduction
        source_hardliner: "CSIS China Power Project 2026; Taiwan MND PLA activity reports, Aug 2026",
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
      color: "#0ea5e9",

      governance: {
        type: "PARLIAMENTARY_DEMOCRACY",
        description:
          "Semi-presidential multi-party democracy. President and " +
          "Legislative Yuan directly elected. High citizen participation. " +
          "No formal mutual-defense treaty with any external power — a real, current stake given " +
          "the January 2026-announced $14B US arms package remains delayed, and the May 2026 " +
          "Trump-Xi summit left US commitment more ambiguous, not more reassuring.",
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
      color: "#ec4899",

      governance: {
        type: "PARLIAMENTARY_DEMOCRACY",
        description:
          "Constitutional monarchy with a parliamentary system. National " +
          "Diet elected; Self-Defense Forces constitutionally constrained " +
          "but expanding role under evolving security doctrine. China banned dual-use tech " +
          "exports to Japanese military end-users in January 2026, directly after Taiwan remarks " +
          "by PM Sanae Takaichi — a real, dated escalation specifically on this bilateral axis, " +
          "not a generic regional one.",
        source: "Freedom House 2024 — Score: 96/100 (Free)",

        proposalThreshold: 200,
        quorum: 40,
        votingMechanism: "ONE_TOKEN_ONE_VOTE",
        coalitionRequired: true,
        vetoCouncil: false,
        guardianVeto: false,
        royalVeto: false,

        reformPressure: 66,          // reasoned estimate, up from the prior baseline (58) — real,
                                      // direct Chinese economic retaliation against Japan specifically
                                      // (the Jan 2026 export ban), alongside real deepening Taiwan-Japan
                                      // semiconductor cooperation (Kumamoto-Kaohsiung-Arizona MOU,
                                      // March 2026), both push toward closer alignment, not a general estimate
        source_reform: "IISS Military Balance 2026; China-Japan export-ban reporting (Jan 2026); Taiwan News (Jul 22, 2026)",
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
        "No formal diplomatic relations. China considers Taiwan a renegade province, not a " +
        "separate state. The May 2026 Trump-Xi summit produced no change to this status quo — " +
        "Xi warned missteps on Taiwan could mean 'conflict' — but real PLA sortie tempo around " +
        "Taiwan has eased toward its pre-2024 baseline rather than continuing to climb.",
      source: "Global Taiwan Institute, Al Jazeera (May 2026); Taiwan MND activity reports (Aug 2026)",
      stabilityScore: 26,          // reasoned estimate, up slightly from the prior baseline (22) —
                                    // reflects real reduced military tempo, offset against real
                                    // unresolved diplomatic ambiguity from the summit
      treatyActive: false,
      treatyName: "",
    },
    {
      from: "china",
      to: "japan",
      type: "COLD",
      description:
        "Deep economic interdependence alongside real, now-concrete security tension: China " +
        "banned dual-use technology exports to Japanese military end-users in January 2026, " +
        "directly following Taiwan remarks by PM Sanae Takaichi — a real, dated act of economic " +
        "retaliation on this specific bilateral relationship, not a background regional dispute.",
        source: "China-Japan export-ban reporting (Jan 2026); IISS Military Balance 2026",
      stabilityScore: 28,          // reasoned estimate, down from the prior baseline (38) — a real,
                                    // named, dated retaliatory act is a materially more concrete
                                    // deterioration than the original "background tension" framing
      treatyActive: false,
      treatyName: "",
    },
    {
      from: "taiwan",
      to: "japan",
      type: "COLD",
      description:
        "No formal diplomatic relations (Japan recognized only the PRC after 1972 normalization) " +
        "but real, deepening informal cooperation — a March 2026 trilateral MOU (Kumamoto " +
        "Prefecture, Kaohsiung City, and Arizona) on advanced semiconductor manufacturing, and " +
        "TSMC's Kumamoto Fab 1 reaching operational breakeven — sharpened by Japan's own " +
        "proximity stakes in a Taiwan Strait crisis.",
      source: "Taiwan News (Jul 22, 2026); BigGo Finance semiconductor forum coverage (2026)",
      stabilityScore: 70,          // reasoned estimate, up from the prior baseline (65) — reflects a
                                    // real, concrete deepening of cooperation, not just proximity stakes
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
        "Decades-old ambiguous arrangement maintained by mutual deterrence, not a signed " +
        "agreement: the US Taiwan Relations Act (1979) commits to Taiwan's defensive capacity " +
        "without a mutual-defense treaty; China's Anti-Secession Law (2005) authorizes " +
        "'non-peaceful means' if Taiwan formally declares independence. A real May 14-15, 2026 " +
        "Trump-Xi summit changed none of this on paper — Xi warned missteps on Taiwan could mean " +
        "'conflict,' and Trump's posture on the long-delayed $14B arms package (announced January " +
        "2026) was ambiguous rather than reassuring. Real PLA exercise tempo, meanwhile, has " +
        "eased back toward its pre-2024 baseline.",
      terms: [
        "China: refrains from military invasion so long as Taiwan doesn't declare formal independence",
        "Taiwan: maintains de facto independence without a formal declaration",
        "US: maintains 'strategic ambiguity' — supplies defensive arms, no mutual-defense treaty " +
          "(the $14B package announced Jan 2026 remains delayed as of this baseline)",
      ],
      vulnerabilities: [
        "No verification mechanism — the arrangement rests entirely on mutual restraint",
        "The May 2026 Trump-Xi summit left US commitment more ambiguous, not more reassuring",
        "China has already shown willingness to retaliate concretely against a third party (Japan, " +
          "Jan 2026) over Taiwan-related remarks — the spillover risk is demonstrated, not theoretical",
        "Taiwanese public opinion trends away from unification over time",
        "US strategic ambiguity itself is domestically contested",
      ],
      source: "US Taiwan Relations Act 1979, China Anti-Secession Law 2005, CSIS 2026, Global Taiwan Institute (May 2026)",
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
        startingValue: 38,        // reasoned estimate, down slightly from the prior baseline (40) —
                                   // real reduced PLA tempo is offset by real unresolved diplomatic
                                   // ambiguity from the May 2026 summit and the delayed arms package
      },
      {
        id: "conflict_events",
        name: "Conflict Events",
        description: "Gray-zone incidents — median-line incursions, air/sea provocations",
        startingValue: 2,         // consistent with real Aug 2026 Taiwan MND reports: single-digit
                                   // daily sorties, several with zero PLA aircraft detected
      },
      {
        id: "trade_volume",
        name: "Trade Volume",
        description: "Economic exchange between the three nations",
        startingValue: 345,       // reasoned estimate, up slightly from the prior baseline (340) —
                                   // reflects real, concrete Taiwan-Japan semiconductor cooperation
                                   // deepening and real US chip-export-control easing toward China
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
        startingValue: 40,        // reasoned estimate, down from the prior baseline (48) — a summit
                                   // that resolved nothing and left the arms package delayed is a real
                                   // erosion in confidence the status quo can hold indefinitely, even
                                   // with lower current military tempo
      },
    ],
  },


  // ─────────────────────────────────────────────
  // STARTING CONDITION PROPOSALS
  //
  // Real, currently-pending or currently-live policy proposals, offered
  // as alternative deploy-time starting conditions for the AI Agent Cycle
  // mode — NOT the same thing as the `experiments` block below, which
  // applies a mid-run change inside the classic fixed-rule engine. Pick
  // exactly one (or none, for the researched default); it overrides the
  // specific parameters that proposal actually affects, real-world, and
  // nothing else. See middle-east-2026.config.cjs's own header comment on
  // this block for the full rationale.
  // ─────────────────────────────────────────────

  startingConditionProposals: [
    {
      id: "as_researched",
      name: "Deploy as researched (default)",
      description: "No override — this scenario's own re-baselined default, as of 2026-08-26.",
      source: null,
      overrides: null,
    },
    {
      id: "arms_package_delivered",
      name: "The $14B arms package is finally delivered",
      description:
        "A bipartisan group of senators urged Trump to formally notify Congress of the $14B " +
        "Taiwan arms package ahead of the May 2026 summit; Trump's own posture on it stayed " +
        "ambiguous rather than reassuring, and it remains delayed. This proposal deploys as if " +
        "the US delivers it after all.",
      source: "exportcompliancedaily.com, \"Senators Call for Moving Ahead With US Arms Sales to Taiwan\" (May 12, 2026)",
      overrides: {
        nations: {
          china:  { governance: { hardlinerPressure: 82 } },
          taiwan: { governance: { hardlinerPressure: 32 } },
        },
        metrics: { deal_integrity: 32, stability_index: 34 },
      },
    },
    {
      id: "china_expands_japan_export_ban",
      name: "China expands the export ban against Japan",
      description:
        "China banned dual-use technology exports to Japanese military end-users in January " +
        "2026, directly after Taiwan remarks by PM Sanae Takaichi. This proposal deploys as if " +
        "that ban is expanded further, rather than staying at its January 2026 scope.",
      source: "China-Japan export-ban reporting (January 2026)",
      overrides: {
        nations: {
          japan: { governance: { reformPressure: 75 } },
          china: { governance: { hardlinerPressure: 78 } },
        },
        metrics: { trade_volume: 310, stability_index: 34 },
      },
    },
    {
      id: "trilateral_semiconductor_pact",
      name: "The Taiwan-Japan semiconductor cooperation is formalized trilaterally",
      description:
        "A March 2026 trilateral MOU (Kumamoto Prefecture, Kaohsiung City, and the US state of " +
        "Arizona) on advanced semiconductor manufacturing is currently informal cooperation. This " +
        "proposal deploys as if it's since been formalized into a binding trilateral pact.",
      source: "Taiwan News, \"Taiwan-Japan supply chains become security strategy\" (July 22, 2026)",
      overrides: {
        nations: {
          japan: { governance: { reformPressure: 72 } },
          china: { governance: { hardlinerPressure: 79 } },
        },
        metrics: { trade_volume: 380 },
      },
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
      question: "What if the US finally delivers the delayed arms package and formally commits to Taiwan's defense?",
      change: {
        target: "nations.china.governance.hardlinerPressure",
        from: 74,
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
      question: "What if Japan formally deepens defense cooperation with Taiwan, on top of already-real semiconductor cooperation?",
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
      question: "What if PLA hardliners gain dominant influence over China's Taiwan policy despite the real recent lull in sortie tempo?",
      change: {
        target: "nations.china.governance.hardlinerPressure",
        from: 74,
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


  // ─────────────────────────────────────────────
  // AI AGENT + QUANTUM LAYER CONFIG
  //
  // Mirrors middle-east-2026.config.cjs's aiAgents block structurally, but
  // every design choice below was made on this scenario's own merits, not
  // copied:
  //
  // ENTANGLEMENT — China x Taiwan, not China x Japan or Taiwan x Japan.
  // This is the direct security-dilemma dyad: China's posture toward
  // "reunification" and Taiwan's posture toward the status quo are not
  // independently describable the same way Iran/Israel weren't — each
  // side's hardening is partly constituted by (not just caused by) the
  // other's. Japan's stakes are real (Senkaku/Yonaguni proximity, its own
  // trade routes, alliance obligations) but structurally one step removed:
  // Japan reacts to a China-Taiwan crisis, it isn't one of the crisis's
  // two poles. That's the same logic that made Saudi Arabia the standalone
  // hedging qubit rather than a third entangled party in the Middle East
  // scenario.
  //
  // AXES — China: hardline (favors coercion/reunification timeline) vs.
  // conciliatory (favors continued ambiguity). Taiwan: resistant (hardens
  // deterrence posture, leans toward formal distancing from Beijing) vs.
  // accommodating (favors reassurance, avoids provocation). Japan:
  // assertive (deepens Taiwan security ties, expands SDF role) vs.
  // restrained (prioritizes economic ties with China, avoids entanglement).
  //
  // ECONOMIC FIELD — the Middle East's OIL/RIAL/RIYAL/GAS logic doesn't
  // transplant conceptually: Saudi Arabia's riyal instrument represented a
  // THIRD party that profits from a rival's crisis (an oil windfall).
  // China isn't a windfall beneficiary of a Taiwan crisis — a blockade or
  // conflict hurts China's own economy too (capital flight, sanctions,
  // decoupling), so CNY here tracks China's own escalation and Japan's
  // export-control leverage, not a windfall. SEMI (semiconductors) takes
  // oil's structural role as the chokepoint commodity the whole crisis
  // pivots on; TWD takes rial's role as the directly-threatened nation's
  // currency; SHIP (global shipping/insurance rates through the strait)
  // takes US gas's role as the damped, lagged, globally-felt echo.
  // ─────────────────────────────────────────────

  aiAgents: {
    // worldKey: the key this nation's data lives under in the flat
    // worldState object buildWorldState() produces. All three of this
    // scenario's ids are already single words, so worldKey === id here.
    entangled: {
      aId: "china",  aWorldKey: "china",  aAxis: ["hardline", "conciliatory"],   aDriverField: "hardlinerPressure", aDriverDirection: "direct",
      bId: "taiwan", bWorldKey: "taiwan", bAxis: ["resistant", "accommodating"], bDriverField: "publicSentiment",   bDriverDirection: "inverse",
    },
    standalone: {
      id: "japan", worldKey: "japan", axis: ["assertive", "restrained"], driverField: "reformPressure", driverDirection: "direct",
    },
    marketInstruments: [
      { key: "primary",   label: "Semiconductor Export Index",      symbol: "SEMI", emoji: "💾", shockLabel: "DISRUPTED", calmLabel: "FLOWING" },
      { key: "currencyA", label: "Taiwan Dollar Index",             symbol: "TWD",  emoji: "🇹🇼", shockLabel: "WEAKENING", calmLabel: "RESILIENT" },
      { key: "currencyB", label: "Chinese Yuan Index",              symbol: "CNY",  emoji: "🇨🇳", shockLabel: "STRAINED",  calmLabel: "STABLE" },
      { key: "global",    label: "Global Shipping Insurance Index", symbol: "SHIP", emoji: "🚢", shockLabel: "SURGING",   calmLabel: "CALM" },
    ],
  },

}

module.exports = TAIWAN_STRAIT_2026

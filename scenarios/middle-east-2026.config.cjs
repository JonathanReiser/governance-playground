/**
 * GOVERNANCE PLAYGROUND
 * Scenario: Middle East — 2026
 *
 * BASELINE AS OF: 2026-08-26 (v2.0.0 — re-baselined; see CHANGELOG below)
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
 *   - Congress.gov CRS: "Possible U.S.-Iran Agreement: INARA and U.S.
 *     Sanctions" (IF13247, updated June 17, 2026)
 *   - Congress.gov CRS: "Iran's Nuclear Program and 2025 UN Sanctions
 *     Reimposition" (IF11583)
 *   - Bloomberg, "Senators Reach Deal on Russia, Iran Sanctions Bill
 *     Targeting Energy Buyers" (July 28, 2026)
 *   - NBC News, "Trump says Saudi Arabia must normalize Israel ties
 *     before nuclear deal is approved" (July 2026)
 *   - INSS, "Saudi Arabia's New Approach to Israel and the Normalization
 *     Process" (2026)
 *   - Haaretz, "Netanyahu Coalition Announces Israel's 2026 Election
 *     Will Take Place on October 27" (July 12, 2026)
 *   - CIE, "2026 Israeli Election Polling: The Month Ending July 31"
 *   - Al Jazeera / CNN / Global Taiwan Institute reporting on the 2026
 *     conflict and the June 2026 US-Iran MOU
 *
 * CHANGELOG (v1.0.0 -> v2.0.0, 2026-08-26):
 * The original baseline described "a new, fragile peace deal" as of May
 * 2026 — Iran capping enrichment, Hormuz open, a ceasefire freshly
 * signed. That premise is no longer what happened. Real events since:
 * the US struck three Iranian nuclear sites in June 2025 (Operation
 * Midnight Hammer — Natanz, Esfahan, Fordow), a further joint US-Israeli
 * campaign struck nuclear fuel-cycle sites again beginning March 1,
 * 2026, and IAEA inspectors were withdrawn after the first round of
 * strikes — the actual extent of damage to Iran's program is disputed,
 * not confirmed. Out of that, a June 2026 US-Iran memorandum of
 * understanding committed both sides to negotiate a comprehensive deal
 * within a maximum 60 days (extendable by mutual consent), with Iran
 * reaffirming it will not pursue nuclear weapons. That window is at or
 * past its original deadline right now. This is not a downgrade from the
 * original scenario — a real post-conflict MOU at its decision point,
 * with contested congressional authority over sanctions relief and an
 * active but conditional Saudi-Israel normalization track, is a richer
 * and more mechanically interesting starting point than a fictional
 * fresh ceasefire, and it's real. Numbers below marked "reasoned
 * estimate" are exactly that — an interpretation of cited real events
 * into this simulation's 0-100 scale, the same practice the original
 * baseline already used (e.g. hardlinerPressure was never a literal V-Dem
 * field), not a claim that a poll produced this specific figure.
 */

const MIDDLE_EAST_2026 = {

  // ─────────────────────────────────────────────
  // SCENARIO METADATA
  // ─────────────────────────────────────────────

  meta: {
    id: "middle-east-2026",
    name: "Middle East — 2026",
    version: "2.0.0",
    baselineAsOf: "2026-08-26",
    description:
      "Post-conflict scenario following real 2025-2026 US/Israeli strikes on Iranian nuclear " +
      "sites and a June 2026 US-Iran memorandum of understanding committing both sides to a " +
      "60-day negotiation window — now at or past that deadline. IAEA access has not been " +
      "restored since the strikes; the real state of Iran's program is disputed, not confirmed. " +
      "Congress has not ratified sanctions relief, and a separate bipartisan Iran/Russia " +
      "sanctions bill is advancing in the Senate. Regional stability is genuinely uncertain.",
    tags: ["middle-east", "post-conflict", "nuclear", "hormuz", "2026"],
    suggestedExperiments: [
      "What if the 60-day MOU window expires with no deal?",
      "What if US Congress blocks sanctions relief?",
      "What if Saudi Arabia formally normalizes with Israel?",
      "What if Iran's hardliners gain domestic power?",
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
      color: "#6366f1",

      governance: {
        type: "PARLIAMENTARY_DEMOCRACY",
        description:
          "Multi-party parliamentary system. Requires coalition " +
          "majorities. High citizen participation. No formal constitution. " +
          "The current Netanyahu coalition is on track to be the first in four decades to " +
          "serve a full term; a general election is set for October 27, 2026, the last " +
          "possible date. Polling through July 2026 shows Netanyahu's bloc short of a " +
          "majority, with an anti-Netanyahu bloc led by former IDF chief Gadi Eisenkot surging.",
        source: "Freedom House 2026 — Score: 76/100; Haaretz, CIE polling (July 2026)",

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
        sentiment: 52,            // reasoned estimate — down from the prior baseline, reflecting a
                                   // contested pre-election climate and Netanyahu's coalition polling
                                   // behind an ascendant opposition bloc, not a specific new poll figure
        source: "Arab Barometer Wave 7 / Pew Research 2026; CIE Israeli election polling, July 2026",
      },
    },


    // ── IRAN ────────────────────────────────────
    {
      id: "iran",
      name: "Iran",
      flag: "🇮🇷",
      color: "#f97316",

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

        hardlinerPressure: 80,    // reasoned estimate, raised from the prior baseline (72) — real
                                   // US/Israeli strikes on Iranian soil in 2025-2026 are a materially
                                   // more inflammatory domestic event than a deal-signing was; not a
                                   // literal survey figure, same interpretive basis the original number used
        source_hardliner: "V-Dem Dataset 2026; strike history per IAEA/ANS reporting and CRS IF12106",
      },

      economy: {
        treasury: 4200,
        source: "World Bank — Iran GDP ~$401B (sanctions-reduced, 2026)",
        sanctioned: true,         // sanctions remain; a bipartisan Senate bill targeting Russia/Iran
                                   // energy buyers cleared a key hurdle July 28, 2026 (Bloomberg) —
                                   // the real pressure is toward MORE sanctions, not relief
        sanctionsReliefPending: true, // contested, not settled: INARA (Iran Nuclear Agreement Review
                                   // Act) gives Congress a review mechanism, H.R. 2012/H.R. 2570 seek to
                                   // condition or mandate that review, and the administration (VP Vance)
                                   // has stated it believes it can lift sanctions without Congress at all
        tradeOpenness: "LOW",
      },

      military: {
        power: 620,
        source: "SIPRI 2026 — est. $10B military expenditure",
        range: [580, 740],        // wide range — estimates are contested
        nuclearCapacity: false,   // per the June 2026 MOU's reaffirmation not to pursue weapons —
                                   // but IAEA inspectors have not returned since the 2025 strikes, so
                                   // this is a diplomatic commitment, not a verified/inspected status
        nuclearDealActive: true,  // the June 2026 MOU, not a comprehensive deal — see activeEvents below
        proxyForces: true,        // Hezbollah, Houthis, Iraqi militias
        proxyCapacity: 85,        // HIGH proxy reach across region
      },

      resources: {
        oil: 80,                  // 2nd largest reserves in OPEC
        water: 25,
        source: "EIA 2026",
        hormuzControl: true,      // can threaten strait closure
        hormuzOpen: true,         // no reporting of an actual closure; strikes targeted nuclear sites,
                                   // not the strait itself
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
      color: "#eab308",

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


    // ── UNITED STATES (external guarantor, not a deal party) ──
    // Standalone qubit like Saudi Arabia, but with a distinct mechanical
    // role: see aiAgents.peacekeeper below and evolveAndCollapseQuantumState()
    // in agents.js — when this qubit collapses to activelyMediate while the
    // Iran/Israel entangled pair is heading toward mutual escalation, it
    // dampens that specific effect rather than adding a generic bonus.
    {
      id: "us",
      name: "United States",
      flag: "🇺🇸",
      color: "#3b82f6",

      governance: {
        // FEDERAL_REPUBLIC is the least-wrong fit in the on-chain
        // GovernanceType enum (PARLIAMENTARY_DEMOCRACY/THEOCRATIC_REPUBLIC/
        // ABSOLUTE_MONARCHY/FEDERAL_REPUBLIC/MILITARY_JUNTA) -- same "no
        // clean slot, map to the closest real thing" precedent already
        // used for China in the Taiwan Strait scenario. "PRESIDENTIAL_REPUBLIC"
        // isn't in that enum at all; contracts.js falls back to 0
        // (PARLIAMENTARY_DEMOCRACY, wrong) and scripts/deploy.js has no
        // fallback and would throw undefined into the contract call.
        type: "FEDERAL_REPUBLIC",
        description:
          "Brokered the June 2026 MOU with Iran; Congress has not ratified sanctions relief and " +
          "is actively contesting who even has that authority — INARA gives Congress a review " +
          "mechanism, competing bills (H.R. 2012, H.R. 2570) seek to condition or mandate it, and " +
          "the administration has separately claimed it can act without Congress at all. Domestic " +
          "political investment in the MOU succeeding is real but conditional, not permanent.",
        source: "Congressional Research Service 2026 (IF13247, IF11583)",

        // Genuinely representative federal system, unlike China's use of the
        // same enum slot (see taiwan-strait-2026.config.cjs) -- broad
        // participation via elected representatives, not a small council, so
        // these numbers reflect that even though the enum label is shared.
        proposalThreshold: 1000,   // moderate — representative, not direct-democracy-low
        quorum: 25,                // large federal republic — lower effective quorum than a small parliament
        votingMechanism: "ONE_TOKEN_ONE_VOTE",
        coalitionRequired: false,  // executive branch action, not a parliamentary coalition
        vetoCouncil: false,
        guardianVeto: false,
        royalVeto: false,

        // Starting lean toward active mediation: having just brokered and
        // publicly staked credibility on the MOU, backing away has a real
        // political cost (audience costs — Fearon 1994), so the prior favors
        // engagement, not disengagement, but it's a lean, not a lock.
        diplomaticCapital: 60,     // reasoned estimate, slightly down from the prior baseline (65) —
                                   // the MOU is a narrower, more contested instrument than a signed
                                   // comprehensive deal, and congressional authority over its central
                                   // economic term is genuinely disputed, not just unratified
        source_capital: "Reflects post-MOU audience-cost exposure and contested congressional authority, not polling data",
      },

      economy: {
        treasury: 27700, // US GDP ~$27.7T (2026), for narrative scale only —
        source: "BEA 2026",
        sanctioned: false,
      },

      military: {
        power: 2100, // SIPRI top-line US military expenditure scale, narrative only
        source: "SIPRI 2026 — ~$920B military expenditure (CENTCOM posture, not full global power projection)",
        range: [1900, 2300],
      },

      population: {
        size: "LARGE",
        sentiment: 48, // domestic appetite for continued Middle East involvement — genuinely split
        source: "Pew Research 2026 (US foreign policy attitudes)",
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
        "Active conflict in 2025-2026 (US/Israeli strikes on Iranian nuclear sites), interrupted " +
        "by a June 2026 US-brokered MOU committing both sides to a 60-day negotiation window — " +
        "now at or past that deadline. No IAEA verification access has been restored since the " +
        "strikes. This is a live decision point, not a settled ceasefire.",
      source: "IAEA/ANS reporting, CRS IF13247, Al Jazeera/CNN 2026 coverage",
      stabilityScore: 22,          // reasoned estimate, down from the prior baseline (28) — a real
                                    // post-strike MOU at its own deadline is more precarious than a
                                    // freshly-signed deal was assumed to be
      treatyActive: true,
      treatyName: "US-Iran Memorandum of Understanding (June 2026)",
    },
    {
      from: "israel",
      to: "saudi_arabia",
      type: "COLD",
      description:
        "No formal diplomatic relations. Real, active pressure toward normalization exists: the " +
        "US made Saudi Arabia's July 2026 civil nuclear cooperation deal conditional on " +
        "normalizing with Israel, and Netanyahu has pushed for a deal before Israel's October 27 " +
        "election. But Saudi Crown Prince Mohammed bin Salman has publicly reaffirmed that " +
        "normalization requires a credible path to Palestinian statehood with East Jerusalem as " +
        "its capital, and a Saudi royal source has said normalization is unlikely under " +
        "Netanyahu's current government specifically.",
      source: "NBC News, INSS, Haaretz — July 2026",
      stabilityScore: 48,          // reasoned estimate — real active pressure exists on both sides,
                                    // but a specific, named obstacle (Palestinian statehood) is publicly
                                    // unresolved, so this is genuinely live, not stalled or settled
      treatyActive: false,
      normalizationTalksActive: true,
    },
    {
      from: "iran",
      to: "saudi_arabia",
      type: "FRAGILE_PEACE",
      description:
        "China-brokered normalization from 2023 holding but strained. Proxy conflicts in Yemen " +
        "and Lebanon create ongoing friction. The 2025-2026 strikes on Iran are a real, separate " +
        "shock to the regional balance this relationship sits inside.",
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
      name: "US-Iran Memorandum of Understanding",
      type: "PEACE_DEAL",
      status: "ACTIVE_FRAGILE",
      parties: ["israel", "iran"],
      externalGuarantor: "US",
      description:
        "Follows real 2025-2026 US/Israeli strikes on Iranian nuclear facilities (Operation " +
        "Midnight Hammer, June 2025; a further joint campaign beginning March 1, 2026). IAEA " +
        "inspectors were withdrawn after the first round and have not returned — the actual " +
        "extent of damage to Iran's program is disputed, not confirmed by outside verification. " +
        "In June 2026 the US and Iran signed an MOU committing to negotiate a comprehensive deal " +
        "within a maximum 60 days, extendable only by mutual consent; Iran reaffirmed it will not " +
        "pursue nuclear weapons. That window is at or past its original deadline now — this " +
        "scenario opens at that decision point, not at a settled outcome.",
      terms: [
        "Iran: reaffirms it will not procure or develop nuclear weapons (MOU language, not an inspected commitment)",
        "Iran: Hormuz Strait remains open to international shipping",
        "US and Iran: committed to negotiate a comprehensive deal within 60 days of the June 2026 MOU",
        "No IAEA verification access restored since the 2025 strikes",
      ],
      vulnerabilities: [
        "No verification mechanism in place — the MOU's core claims are unconfirmed",
        "US Congress has not ratified sanctions relief, and disputes whether it must be asked at all",
        "A separate bipartisan Senate bill (cleared a key hurdle July 28, 2026) would add further " +
          "sanctions on Iran/Russia energy buyers, cutting against the MOU's premise",
        "Iranian Revolutionary Guard not party to the MOU",
        "Israeli far-right coalition partners' position on the MOU is unresolved ahead of the October 27 election",
      ],
      source: "IAEA/ANS reporting, Congress.gov CRS IF13247/IF11583, Bloomberg (July 28, 2026)",
    },
    {
      id: "hormuz_status",
      name: "Hormuz Strait Status",
      type: "RESOURCE_EVENT",
      status: "OPEN",
      controlledBy: "iran",
      description:
        "Strait is currently open — no reporting of an actual closure during the 2025-2026 " +
        "strikes, which targeted nuclear fuel-cycle sites rather than the strait. 20% of global " +
        "oil supply passes through this chokepoint. Iran retains the legal and physical ability " +
        "to close it.",
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
        startingValue: 32,        // reasoned estimate, down from the prior baseline (38) — a real
                                   // post-strike MOU at its own 60-day deadline, with no restored
                                   // verification access, is a more volatile starting point than a
                                   // freshly-signed deal was assumed to be
      },
      {
        id: "conflict_events",
        name: "Conflict Events",
        description: "Number of hostile cross-DAO actions per cycle",
        startingValue: 4,         // reasoned estimate, up from 3 — reflects the real strike history
                                   // this scenario now opens after, not an active clash this cycle
      },
      {
        id: "trade_volume",
        name: "Trade Volume",
        description: "Economic exchange between nations",
        startingValue: 110,       // reduced — sanctions remain contested, and a further sanctions
                                   // bill is actively advancing in the Senate (Bloomberg, July 2026)
      },
      {
        id: "proxy_activity",
        name: "Proxy Activity",
        description: "Cross-border faction funding and operations",
        startingValue: 48,
      },
      {
        id: "deal_integrity",
        name: "MOU Integrity",
        description: "Likelihood the current US-Iran MOU holds and converts into a real deal (0–100)",
        startingValue: 42,        // reasoned estimate, down from the prior baseline (52) — an MOU at
                                   // its own deadline, with unresolved verification and contested
                                   // congressional authority, starts from a weaker position than a
                                   // freshly-signed comprehensive deal would have
      },
    ],
  },


  // ─────────────────────────────────────────────
  // SUGGESTED EXPERIMENTS
  // ─────────────────────────────────────────────

  experiments: [
    {
      id: "exp_deal_collapse",
      name: "The MOU Collapses",
      question: "What happens if the 60-day window expires with no deal?",
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
      question: "What if Congress asserts INARA review and blocks relief outright?",
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
        "MOU integrity drops. " +
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
      question: "What if Saudi Arabia formally recognizes Israel despite the Palestinian-statehood condition?",
      change: {
        target: "relationships.israel_saudi.type",
        from: "COLD",
        to: "PARTNER",
      },
      effects: { trade: { delta: 200 }, stability: { delta: 12 }, proxy: { delta: 8 } },
      hypothesis:
        "Regional trade increases significantly. " +
        "Iran feels encircled — hardliner pressure rises. " +
        "Palestinian statehood loses leverage as an obstacle.",
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
      question: "What if hardliners consolidate further off the real post-strike backlash?",
      change: {
        target: "nations.iran.governance.hardlinerPressure",
        from: 80,
        to: 95,
      },
      effects: { dealIntegrity: { delta: -35 }, proxy: { delta: 25 }, stability: { delta: -10 }, isHardlinerEvent: true },
      hypothesis:
        "Iran walks away from the MOU. " +
        "Hormuz threatened within 4 cycles. " +
        "Proxy activity surges to maximum.",
      hypothesisChecks: [
        { label: "Iran walks from the MOU (integrity → 0)", metric: "dealIntegrity", op: "equals", value: 0 },
        { label: "Proxy activity surged to max >80", metric: "proxy", op: "above", value: 80 },
        { label: "Hormuz threatened (cycles below 50 trade)", metric: "trade", op: "cyclesBelow", value: 50 },
        { label: "Significant stability drop >15 pts", metric: "stability", op: "belowBaselineMinus", value: 15 },
      ],
    },
  ],


  // ─────────────────────────────────────────────
  // STARTING CONDITION PROPOSALS
  //
  // Real, currently-pending or currently-live policy proposals, offered
  // as alternative deploy-time starting conditions for the AI Agent Cycle
  // mode — NOT the same thing as the `experiments` block above, which
  // applies a mid-run change inside the classic fixed-rule engine. Pick
  // exactly one (or none, for the researched default); it overrides the
  // specific parameters that proposal actually affects, real-world, and
  // nothing else — same "one variable changed at a time" discipline this
  // project's whole pitch rests on, just grounded in what's actually
  // being debated right now instead of an abstract slider.
  //
  // `overrides.nations.<id>` deep-merges into that nation's config;
  // `overrides.metrics.<simulation.metrics id>` sets that metric's
  // startingValue. See frontend/src/lib/scenarioOverrides.js /
  // server/scenarioOverrides.js for the (shared-by-duplication, same
  // precedent as the deploy logic itself) function that applies these.
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
      id: "congress_blocks_relief",
      name: "Congress blocks sanctions relief outright",
      description:
        "H.R. 2012 and H.R. 2570 seek to mandate congressional review of any Iran sanctions " +
        "relief under the Iran Nuclear Agreement Review Act (INARA). This proposal deploys as if " +
        "that review succeeds and Congress blocks relief outright, rather than leaving the " +
        "question pending.",
      source: "Congress.gov CRS IF13247 (INARA and U.S. Sanctions, updated June 17, 2026)",
      overrides: {
        nations: {
          iran: {
            economy: { sanctionsReliefPending: false, sanctioned: true },
            governance: { hardlinerPressure: 88 },
          },
          us: {
            governance: { diplomaticCapital: 45 },
          },
        },
        metrics: { deal_integrity: 25, stability_index: 26 },
      },
    },
    {
      id: "senate_sanctions_bill_enacted",
      name: "The Iran/Russia sanctions bill is enacted",
      description:
        "A bipartisan Senate bill adding sanctions on major buyers of Russian and Iranian energy " +
        "cleared a key procedural hurdle on July 28, 2026. This proposal deploys as if it's since " +
        "been signed into law.",
      source: "Bloomberg, \"Senators Reach Deal on Russia, Iran Sanctions Bill Targeting Energy Buyers\" (July 28, 2026)",
      overrides: {
        nations: {
          iran: {
            economy: { sanctionsReliefPending: false, sanctioned: true },
            governance: { hardlinerPressure: 85 },
          },
        },
        metrics: { trade_volume: 85, deal_integrity: 30 },
      },
    },
    {
      id: "saudi_normalizes_anyway",
      name: "Saudi Arabia normalizes with Israel despite Netanyahu",
      description:
        "A Saudi royal source has said normalization is unlikely under Netanyahu's current " +
        "government specifically, and MBS has publicly conditioned normalization on a credible " +
        "Palestinian-statehood path. This proposal deploys as if Saudi Arabia moves forward " +
        "anyway, accepting the US nuclear-deal-linked pressure over its own stated precondition.",
      source: "NBC News, INSS, Haaretz (July 2026)",
      overrides: {
        nations: {
          saudi_arabia: { governance: { reformPressure: 65 } },
          iran: { governance: { hardlinerPressure: 85 } }, // real-mechanism proxy: Iran reading this as encirclement
        },
        metrics: { stability_index: 36, trade_volume: 140 },
      },
    },

    {
      // RESTORED TO SOURCE 2026-09-02. This condition existed ONLY in the
      // generated frontend/src/scenarios/middle-east-2026.json and had no
      // entry in this file at all — it was presumably hand-edited into the
      // JSON and never written back here. Published batch 853a7c92 ran on
      // it, so a plain `node scripts/generate-scenario-json.cjs` would have
      // silently deleted the starting condition behind an already-published
      // preregistered result. Copied back verbatim from that JSON, values
      // unchanged, so regeneration is now lossless.
      //
      // Note it sets Israel's sentiment in BOTH places —
      // governance.publicSentiment and population.sentiment. agents.js:319
      // reads population.sentiment; the governance one is inert. Left
      // exactly as it ran so 853a7c92 stays reproducible byte-for-byte.
      id: "eisenkot_wins_election",
      name: "Eisenkot wins the October 27 election instead of Netanyahu",
      description:
        "Real opposition figure (former IDF Chief of Staff, 'Yashar' party) whose bloc is polling " +
        "ahead of Netanyahu's as of this scenario's own baseline. Deliberately narrow: this does " +
        "NOT model a shift toward Palestinian statehood \u2014 Eisenkot has categorically rejected it " +
        "('There is no Palestinian state, and under a government we form, no Palestinian state will " +
        "be established,' Haaretz, Aug 22 2026), a position shared by every other leading contender " +
        "(Bennett, Lapid); the only mainstream figure raising statehood is Mansour Abbas (Ra'am), a " +
        "potential coalition partner, not a PM contender. What plausibly differs from Netanyahu isn't " +
        "the Palestinian-statehood posture but domestic legitimacy \u2014 an accountability-era platform " +
        "(a state commission of inquiry into October 7, a new national security doctrine) and a " +
        "coalition not dependent on his far-right partners. Modeled here as a moderate rise in public " +
        "sentiment reflecting the real polling momentum this scenario's baseline already cites, not a " +
        "substantive foreign-policy shift.",
      source: "Haaretz (Aug 22, 2026); Middle East Eye; Arab News; i24NEWS; Times of Israel",
      overrides: {
        nations: {
          israel: {
            governance: { publicSentiment: 60 },
            population: { sentiment: 60 },
          },
        },
      },
    },

    // ── INSTRUMENT-TEST CONDITIONS ──────────────────────────────
    //
    // The three below differ from every proposal above in WHY they
    // exist, and that difference is stated here rather than buried,
    // because it changes how a result from them should be read.
    //
    // The proposals above each deploy a specific contested real-world
    // question (does Congress block relief; does Saudi normalize).
    // These three exist to test the INSTRUMENT: across all 9 published
    // preregistered batches, Iran's and Israel's agents proposed a net
    // escalation in essentially every cycle — conflictEvents is never
    // negative in any published cycle for either nation, and that holds
    // in cycle 1, before any agent-caused decline, so it is not a
    // spiral. The reason appears to be that the scenario's own baseline
    // starts past the escalatory side of the thresholds in the agents'
    // system prompts (server.js):
    //
    //   Iran hardlinerPressure baseline 80, prompt branches at > 70
    //     ("any deal concession triggers a legitimacy crisis. You must
    //     compensate with visible defiance elsewhere"). Lowest value
    //     reached in any of 41 published trials: 72. Never opened.
    //   Regional stability baseline 32, prompt's only de-escalatory
    //     branch is the gains frame at > 60 ("defend what you have,
    //     avoid reckless moves"). Highest value observed across 80
    //     published cycles: 44. Never reached.
    //
    // So the published finding "the agents escalate" may be a restatement
    // of where the scenario starts rather than a discovered property of
    // the agents. These conditions open those gates and nothing else, so
    // the two explanations come apart. A result either way is publishable:
    // if the agents de-escalate once the gates are open, the escalation
    // was regime-driven; if they escalate anyway, it is not, and that is
    // the stronger claim.
    //
    // These are grounded, not arbitrary sliders — the MOU actually
    // producing a comprehensive deal is the real counterfactual this
    // whole scenario is built around, and is the one path that would
    // plausibly move both variables at once. But the specific VALUES
    // were chosen to sit just past the prompt's own thresholds rather
    // than derived from any source, and that is a methodological choice,
    // not a reasoned estimate of a real quantity. Stated plainly here so
    // no writeup can present it as the latter.
    {
      id: "mou_deal_concluded",
      name: "The MOU produces a comprehensive deal (both gates open)",
      description:
        "The June 2026 US-Iran MOU committed both sides to negotiate a comprehensive deal within " +
        "60 days. Every proposal above deploys some version of that window failing. This one " +
        "deploys it succeeding: a deal concluded, IAEA inspectors readmitted, sanctions relief " +
        "delivered. Values are set just past the escalation thresholds in both agents' system " +
        "prompts (hardlinerPressure below 70, stability above 60) so that the prompt's " +
        "de-escalatory branches are reachable for the first time — see the note above this block.",
      source:
        "Congress.gov CRS IF13247 (the MOU and its 60-day window); threshold values are a " +
        "methodological choice, not a sourced estimate",
      overrides: {
        nations: {
          iran: {
            economy: { sanctionsReliefPending: false, sanctioned: false },
            governance: { hardlinerPressure: 65 },
          },
          israel: { population: { sentiment: 68 } }, // population.sentiment, NOT governance — see agents.js:319
          us: { governance: { diplomaticCapital: 78 } },
        },
        metrics: { deal_integrity: 82, stability_index: 62, conflict_events: 1 },
      },
    },
    {
      id: "gate_stability_only",
      name: "Stability gate only (isolates the prospect-theory branch)",
      description:
        "Half of mou_deal_concluded: regional stability above the gains-frame threshold, but " +
        "Iran's hardlinerPressure left at its escalatory baseline. Isolates which of the two " +
        "gates is actually binding. Only worth running if the combined condition comes back " +
        "escalatory — see the note above this block.",
      source: "methodological probe, not a sourced scenario",
      overrides: {
        metrics: { stability_index: 62 },
      },
    },
    {
      id: "gate_hardliner_only",
      name: "Hardliner gate only (isolates the two-level-games branch)",
      description:
        "The other half: Iran's hardlinerPressure below the 'visible defiance' threshold, but " +
        "regional stability left at its baseline. Paired with gate_stability_only to attribute " +
        "any effect to one branch or the other rather than to the pair.",
      source: "methodological probe, not a sourced scenario",
      overrides: {
        nations: { iran: { governance: { hardlinerPressure: 65 } } },
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
    israel:       [ { slot: 0, amount: 200000 }, { slot: 3, amount: 500000 }, { slot: 4, amount: 200000 }, { slot: 5, amount: 100000 } ],
    iran:         [ { slot: 0, amount: 100000 }, { slot: 3, amount: 300000 }, { slot: 4, amount: 500000 }, { slot: 5, amount: 100000 } ],
    saudi_arabia: [ { slot: 2, amount: 800000 }, { slot: 3, amount: 150000 }, { slot: 5, amount: 50000  } ],
  },


  // ─────────────────────────────────────────────
  // AI AGENT + QUANTUM LAYER CONFIG
  //
  // The structural design decisions the AI Agent Cycle mode needs and
  // can't infer from the rest of the config: which two nations' postures
  // are genuinely entangled (a structural coupling, not incidental —
  // see quantum_extension design rationale), which nation hedges as a
  // standalone qubit, which of each nation's own governance fields drives
  // its qubit's rotation each cycle, and what the derived economic field
  // (Layer 2/3) actually represents here. frontend/src/lib/agents.js and
  // markets.js read this generically; server.js's SYSTEM_PROMPTS and the
  // headline generator are keyed by meta.id since prompt text itself
  // isn't data-driveable the same way.
  //
  // driverDirection: "direct" = rising driver value rotates toward axis[0]
  // (the first label); "inverse" = rising driver value rotates toward
  // axis[1]. E.g. Iran's hardlinerPressure rising pushes toward "hardline"
  // (axis[0], direct); Israel's publicSentiment FALLING (not rising) is
  // what pushes toward "hawkish" (axis[0], inverse).
  // ─────────────────────────────────────────────

  aiAgents: {
    // worldKey: the key this nation's data lives under in the flat
    // worldState object buildWorldState() produces (usually === id, except
    // where the id has an underscore and the worldState convention is
    // camelCase — e.g. saudi_arabia -> saudiArabia).
    entangled: {
      aId: "iran",   aWorldKey: "iran",   aAxis: ["hardline", "pragmatic"], aDriverField: "hardlinerPressure", aDriverDirection: "direct",
      bId: "israel", bWorldKey: "israel", bAxis: ["hawkish", "dovish"],      bDriverField: "publicSentiment",   bDriverDirection: "inverse",
    },
    standalone: {
      id: "saudi_arabia", worldKey: "saudiArabia", axis: ["bold", "cautious"], driverField: "reformPressure", driverDirection: "direct",
    },
    // A second standalone qubit, deliberately not generalized into
    // `standalone` becoming an array — this one has a distinct mechanical
    // role (damping the entangled pair's escalation effect, see
    // evolveAndCollapseQuantumState() in agents.js), not just "another
    // nation that hedges independently". Optional: scenarios without a
    // peacekeeper (e.g. Taiwan Strait, not built yet) simply omit this key
    // and every consumer treats it as absent, not an error.
    peacekeeper: {
      id: "us", worldKey: "us", axis: ["activelyMediate", "disengage"],
      driverField: "diplomaticCapital", driverDirection: "direct",
    },
    marketInstruments: [
      { key: "primary",   label: "Oil Index",   symbol: "OIL",  emoji: "🛢",  shockLabel: "SPIKING",   calmLabel: "STABLE" },
      { key: "currencyA", label: "Rial Index",  symbol: "RIAL", emoji: "🇮🇷", shockLabel: "WEAKENING", calmLabel: "RESILIENT" },
      { key: "currencyB", label: "Riyal Index", symbol: "RIYAL",emoji: "🇸🇦", shockLabel: "ROBUST",    calmLabel: "STRAINED" },
      { key: "global",    label: "US Gas / USD",symbol: "GAS",  emoji: "⛽",  shockLabel: "SURGING",   calmLabel: "CALM" },
    ],
  },

}

module.exports = MIDDLE_EAST_2026

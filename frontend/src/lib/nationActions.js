/**
 * Structured per-nation action menus + metric-delta bounds, for the human
 * decision form (AICycleStep.jsx's "Human decides" mode).
 *
 * IMPORTANT: this is transcribed by hand from each nation's "## Available
 * Actions" / metricDeltas block in server.js's SYSTEM_PROMPTS, not derived
 * from a shared source. If a prompt's action list or bounds change, this
 * file needs the same edit or the human form will drift out of sync with
 * what the AI agent for that nation is actually allowed to do. Kept
 * separate rather than refactoring SYSTEM_PROMPTS to interpolate from here,
 * since that touches already-validated, real-data-tested prompt text — a
 * good follow-up, deliberately not bundled into this feature.
 */

export const NATION_ACTIONS = {
  "middle-east-2026": {
    iran: {
      categories: {
        DIPLOMATIC: ["HONOR_DEAL", "DELAY_COMPLIANCE", "DEMAND_RENEGOTIATION", "EXIT_DEAL"],
        "MILITARY/PROXY": ["MAINTAIN_PROXY_TEMPO", "ESCALATE_PROXY", "THREATEN_HORMUZ", "CLOSE_HORMUZ"],
        ECONOMIC: ["WAIT_FOR_SANCTIONS_RELIEF", "ACCELERATE_CHINA_TIES", "OIL_MARKET_SIGNAL"],
        DOMESTIC: ["PURGE_MODERATES", "ELEVATE_IRGC", "SUPPRESS_PROTESTS"],
      },
      metricBounds: {
        stability: [-15, 10],
        proxyActivity: [-20, 20],
        tradeVolume: [-30, 30],
        conflictEvents: [-3, 5],
        dealIntegrity: [-25, 10],
        hardlinerPressure: [-10, 15],
      },
    },
    israel: {
      categories: {
        DIPLOMATIC: ["HONOR_DEAL", "DEMAND_VERIFICATION", "BACKTRACK_CONCESSION", "EXIT_DEAL", "PURSUE_SAUDI_NORMALIZATION"],
        MILITARY: ["MAINTAIN_DETERRENCE", "COVERT_PRESSURE", "AIRSTRIKE_THREAT", "PREEMPTIVE_STRIKE"],
        ECONOMIC: ["DEEPEN_US_TIES", "TRADE_CORRIDOR_PUSH", "SANCTIONS_PRESSURE"],
        DOMESTIC: ["COALITION_MANAGEMENT", "SECURITY_CABINET_BRIEF"],
      },
      metricBounds: {
        stability: [-15, 10],
        proxyActivity: [-10, 10],
        tradeVolume: [-20, 25],
        conflictEvents: [-2, 6],
        dealIntegrity: [-20, 8],
        publicSentiment: [-10, 8],
      },
    },
    saudi_arabia: {
      categories: {
        DIPLOMATIC: ["SUPPORT_DEAL_PUBLICLY", "BACK_CHANNEL_IRAN", "ADVANCE_NORMALIZATION", "PAUSE_NORMALIZATION", "INVOKE_BEIJING_AGREEMENT"],
        "ECONOMIC/OIL": ["INCREASE_OIL_PRODUCTION", "CUT_OIL_PRODUCTION", "VISION_2030_SIGNAL", "ECONOMIC_AID_CORRIDOR"],
        MILITARY: ["MAINTAIN_POSTURE", "ESCALATE_YEMEN", "DE_ESCALATE_YEMEN", "US_SECURITY_REQUEST"],
        DOMESTIC: ["RELIGIOUS_ESTABLISHMENT_SIGNAL", "MODERNIZATION_PUSH"],
      },
      metricBounds: {
        stability: [-10, 12],
        proxyActivity: [-20, 15],
        tradeVolume: [-25, 35],
        conflictEvents: [-3, 4],
        dealIntegrity: [-10, 12],
        reformPressure: [-8, 10],
      },
    },
  },
};

/** Returns { categories, metricBounds } for a nation, or null if this
 * scenario/nation combination hasn't had its action menu transcribed yet
 * (e.g. Taiwan Strait — not done in this pass; human mode simply isn't
 * offered for nations with no entry here, see AICycleStep.jsx). */
export function nationActionMenu(scenarioId, nationId) {
  return NATION_ACTIONS[scenarioId]?.[nationId] ?? null;
}

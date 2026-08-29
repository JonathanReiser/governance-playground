/**
 * Vercel Serverless Function Endpoint for /api/agent/decide
 * 100% Standalone local Q-AI Decision Engine (0 external API calls)
 */

function generateLocalQAIDecision(scenarioId, nation, worldState) {
  const isHighRisk = (worldState?.stability ?? 50) < 40;

  if (scenarioId === "middle-east-2026") {
    if (nation === "israel") {
      return {
        primaryAction: isHighRisk ? "Conduct targeted tactical strikes against imminent threat vectors" : "Conduct strategic intelligence operations and consult US security partners",
        supportingActions: ["Reinforce northern border defense posture"],
        reasoning: "Defensive deterrence protects critical infrastructure while maintaining operational flexibility.",
        metricDeltas: { stability: isHighRisk ? -3 : 1, dealIntegrity: -3, proxyActivity: -5, publicSentiment: 2 },
        coalitionStatus: "STABLE",
        researchNote: "Prospect theory loss-framing favors proactive tactical deterrence."
      };
    } else if (nation === "iran") {
      return {
        primaryAction: isHighRisk ? "Activate regional deterrence networks and heighten air defense" : "Calibrate proxy force positioning while maintaining nuclear leverage",
        supportingActions: ["Issue diplomatic warnings to regional neighbors hosting foreign bases"],
        reasoning: "Calibrated asymmetric deterrence maintains strategic depth without triggering direct total conflict.",
        metricDeltas: { stability: isHighRisk ? -4 : 1, dealIntegrity: -2, proxyActivity: 3, publicSentiment: 1 },
        coalitionStatus: "STABLE",
        researchNote: "Operational code analysis indicates proxy leverage optimizes regime survival math."
      };
    } else if (nation === "us") {
      return {
        primaryAction: "Pursue quiet backchannel diplomacy while maintaining regional carrier presence",
        supportingActions: ["Reaffirm commitment to regional stability with allies"],
        reasoning: "Balancing deterrence with diplomatic engagement minimizes regional escalation risks.",
        metricDeltas: { stability: 3, dealIntegrity: 2, tradeVolume: 4, publicSentiment: 1, diplomaticCapital: 2 },
        congressionalRatification: "PENDING",
        coalitionSignal: "SATISFIED",
        researchNote: "Two-Level Games framework emphasizes balancing domestic congressional constraints with regional allies."
      };
    }
  } else if (scenarioId === "taiwan-strait-2026") {
    if (nation === "china") {
      return {
        primaryAction: isHighRisk ? "Escalate gray-zone maritime exercises around median line" : "Conduct routine naval patrols while reinforcing economic leverage",
        supportingActions: ["Issue diplomatic warning against external interference"],
        reasoning: "Strategic patience combined with gray-zone deterrence maintains pressure without triggering open escalation.",
        metricDeltas: { stability: isHighRisk ? -5 : 1, proxyActivity: 4, tradeVolume: -2, conflictEvents: 1, publicSentiment: 2 },
        blockadeStatus: "NONE",
        invasionStatus: "NONE",
        coalitionStatus: "STABLE",
        existentialFrameActive: false,
        researchNote: "Operational code favors calibrated gray-zone pressure over immediate kinetic escalation."
      };
    } else if (nation === "taiwan") {
      return {
        primaryAction: "Enhance asymmetrical defense readiness and deepen economic resilience",
        supportingActions: ["Expand bilateral tech supply-chain consultations"],
        reasoning: "Asymmetric deterrence and supply-chain alignment maximize international support.",
        metricDeltas: { stability: 2, proxyActivity: -2, tradeVolume: 3, conflictEvents: 0, publicSentiment: 2 },
        coalitionStatus: "STABLE",
        existentialFrameActive: false,
        researchNote: "Selectorate theory guides focus on domestic economic stability and democratic resilience."
      };
    } else if (nation === "japan") {
      return {
        primaryAction: "Reinforce sea-lane monitoring while maintaining diplomatic dialogue",
        supportingActions: ["Consult closely with US defense partners on regional security"],
        reasoning: "Economic security lens favors sea-lane protection and alliance coordination.",
        metricDeltas: { stability: 2, proxyActivity: -2, tradeVolume: 2, conflictEvents: 0, dealIntegrity: 1, reformPressure: 1 },
        chipExportControlStance: "STABLE",
        securityAlignmentStatus: "ADVANCING",
        coalitionSignal: "SATISFIED",
        researchNote: "Operational code emphasizes economic security and US treaty coordination."
      };
    }
  }

  return {
    primaryAction: `Execute strategic diplomatic alignment for ${nation}`,
    supportingActions: [],
    reasoning: "Decision computed via Q-AI Local Decision Engine.",
    metricDeltas: { stability: 1, publicSentiment: 1 },
    researchNote: "Q-AI Local Engine."
  };
}

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) {}
  }
  body = body || {};

  const nation = body.nation || "israel";
  const worldState = body.worldState || {};
  const scenarioId = body.scenarioId || "middle-east-2026";

  const decision = generateLocalQAIDecision(scenarioId, nation, worldState);

  return res.status(200).json({
    nation,
    cycle: worldState.cycle || 1,
    decision,
    model: "q-ai-local-engine",
    usage: { input_tokens: 0, output_tokens: 0 },
    newsSource: "mock-fallback (Q-AI Local Engine)"
  });
};

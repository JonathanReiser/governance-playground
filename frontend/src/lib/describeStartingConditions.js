import { applyStartingConditionOverrides } from "./scenarioOverrides";

const FIELD_LABELS = {
  hardlinerPressure: "hardliner pressure", reformPressure: "reform pressure",
  diplomaticCapital: "diplomatic capital", sanctionsReliefPending: "sanctions relief pending",
  sanctioned: "sanctioned", treasury: "treasury",
};

/**
 * Turns one or more starting-condition proposals into a real, numeric
 * "was X, becomes Y" summary — the answer to "what actually is this
 * baseline?" instead of a name and a paragraph of prose. No selection
 * shows the scenario's own current starting metrics directly; one or
 * more proposals are diffed against those same numbers, using the REAL
 * combined result (via applyStartingConditionOverrides) so a field two
 * proposals both touch shows its actual final value, not each proposal's
 * own value in isolation — same last-one-wins resolution the deploy
 * itself uses.
 *
 * Originally lived only in LiveDemoPanel.jsx's picking screen (the "what
 * am I about to deploy" preview). Pulled out to here so ExperimentBanner
 * can show the exact same numbers everywhere a run's setup matters —
 * including mid-run, while reading agent reasoning that references one
 * of these values — not just at the moment of picking. See
 * ExperimentBanner.jsx's header comment for that feedback.
 */
export function describeStartingConditions(scenarioData, proposals) {
  if (!scenarioData) return "";
  if (proposals.length === 0) {
    return scenarioData.simulation.metrics
      .map((m) => `${m.name}: ${m.startingValue}`)
      .join(" · ");
  }

  const combined = applyStartingConditionOverrides(scenarioData, proposals.map((p) => p.id));
  const parts = [];
  const seenMetrics = new Set();
  const seenNationFields = new Set();

  for (const proposal of proposals) {
    const { nations, metrics } = proposal.overrides || {};
    if (metrics) {
      for (const id of Object.keys(metrics)) {
        if (seenMetrics.has(id)) continue;
        seenMetrics.add(id);
        const name = scenarioData.simulation.metrics.find((m) => m.id === id)?.name || id;
        const was = scenarioData.simulation.metrics.find((m) => m.id === id)?.startingValue;
        const now = combined.simulation.metrics.find((m) => m.id === id)?.startingValue;
        parts.push(`${name}: ${was} → ${now}`);
      }
    }
    if (nations) {
      for (const [nationId, patch] of Object.entries(nations)) {
        for (const fields of Object.values(patch)) {
          for (const field of Object.keys(fields)) {
            const key = `${nationId}.${field}`;
            if (seenNationFields.has(key)) continue;
            seenNationFields.add(key);
            const before = scenarioData.nations.find((n) => n.id === nationId);
            const after = combined.nations.find((n) => n.id === nationId);
            const was = before?.governance?.[field] ?? before?.economy?.[field];
            const now = after?.governance?.[field] ?? after?.economy?.[field];
            const label = FIELD_LABELS[field] || field;
            parts.push(`${after?.name || nationId} ${label}: ${String(was)} → ${String(now)}`);
          }
        }
      }
    }
  }
  return parts.join(" · ");
}

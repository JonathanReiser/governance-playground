/**
 * Applies one of a scenario's `startingConditionProposals` — real, cited
 * policy proposals offered as alternative deploy-time starting conditions
 * (see scenarios/*.config.cjs's own header comment on that block for the
 * rationale) — to a scenario object before deploy.
 *
 * Deliberately not a generic JSON-path engine: only two shapes are ever
 * overridden (a nation's config, deep-merged; a simulation metric's
 * startingValue, set directly), because those are the only two things a
 * deploy actually reads real starting values from. `overrides.nations`
 * and `overrides.metrics` in the scenario config mirror that directly.
 *
 * Security note: this function only ever reads a proposal that already
 * exists in the scenario's OWN `startingConditionProposals` array — the
 * caller passes an id (a string the client picked from an allowlisted
 * menu), never override values themselves. An unknown/missing id falls
 * back to the unmodified scenario rather than throwing, so a bad id never
 * corrupts a deploy — it just deploys the researched default.
 *
 * Duplicated in frontend/src/lib/scenarioOverrides.js rather than shared
 * — same module-system split (this is CommonJS, the frontend is ESM) and
 * same reasoning demoDeploy.js's own header comment already gives for its
 * duplicated deploy logic.
 */

function deepMerge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = deepMerge(target[key] ? { ...target[key] } : {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function applyStartingConditionOverride(scenario, overrideId) {
  const proposal = (scenario.startingConditionProposals || []).find((p) => p.id === overrideId);
  if (!proposal || !proposal.overrides) return scenario;

  const next = JSON.parse(JSON.stringify(scenario));
  const { nations, metrics } = proposal.overrides;

  if (nations) {
    for (const [nationId, patch] of Object.entries(nations)) {
      const nation = next.nations.find((n) => n.id === nationId);
      if (nation) deepMerge(nation, patch);
    }
  }
  if (metrics) {
    for (const [metricId, value] of Object.entries(metrics)) {
      const metric = next.simulation.metrics.find((m) => m.id === metricId);
      if (metric) metric.startingValue = value;
    }
  }
  return next;
}

/**
 * Applies SEVERAL proposals at once, in the order given — folding each
 * one's overrides on top of the last, so "manipulating multiple
 * variables together" (picking, say, both a sanctions-bill proposal and
 * a Saudi-normalization proposal) is just this function applied to a
 * scenario that already has the first proposal's overrides baked in.
 *
 * Real proposals do overlap on some fields (e.g. two Middle East 2026
 * proposals both set Iran's hardlinerPressure, to different values) —
 * this resolves that the same way any layered-override system does:
 * last one in `overrideIds` wins for that specific field. Nothing here
 * tries to detect or merge conflicting values more cleverly than that;
 * the frontend's own combined-diff preview is what actually surfaces an
 * overlap to whoever is picking, before they deploy anything.
 *
 * `overrideIds` may be a single id (treated as a one-element list, for
 * callers that only ever apply one), an array of ids, or empty/missing
 * (returns the scenario unchanged, same as an unknown single id would).
 */
function applyStartingConditionOverrides(scenario, overrideIds) {
  const ids = Array.isArray(overrideIds) ? overrideIds : overrideIds ? [overrideIds] : [];
  return ids.reduce((acc, id) => applyStartingConditionOverride(acc, id), scenario);
}

module.exports = { applyStartingConditionOverride, applyStartingConditionOverrides };

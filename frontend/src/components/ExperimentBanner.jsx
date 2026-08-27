import { describeStartingConditions } from "../lib/describeStartingConditions";

/**
 * Which experiment is actually running, shown identically everywhere a
 * visitor might be looking at a run's output — the deploy screens and
 * every phase of "watch it play out" — not just at the moment it was
 * picked. Feedback that prompted this: after watching agents reason
 * through several cycles, there was no reminder anywhere on screen of
 * which starting condition/variable this particular run was testing.
 *
 * Follow-up feedback ("when watching it play out, you dont see the same
 * set up you did before you set the conditions... good to still have
 * that... when reading agent reasoning, you can have that to fall back
 * on"): the name/description of a condition isn't enough to make sense
 * of an agent citing a specific number mid-run — you need the actual
 * "was X, becomes Y" values the picking screen showed. `scenarioData`
 * (optional) unlocks that numeric line via the same
 * describeStartingConditions() the picker itself uses, so it's the exact
 * same numbers, not a re-derivation. Omit it and the banner still works,
 * just without that line — callers that don't have the full scenario
 * bundle handy (there shouldn't be any left) degrade gracefully.
 *
 * `startingConditions` is an ARRAY — a visitor can combine several real
 * proposals into one deploy (see LiveDemoPanel.jsx's picker), and this
 * shows all of them, not just the first. Three states:
 *   - `null`/`undefined` (not yet known, e.g. before a deploy starts):
 *     renders nothing, rather than an empty or misleading banner.
 *   - `[]` (deployed as researched, nothing overridden): shows the
 *     scenario's own baseline as the "condition."
 *   - one or more `{ name, description? }`: shows each, numbered once
 *     there's more than one to combine.
 */
export function ExperimentBanner({ scenarioName, startingConditions, scenarioData }) {
  if (!startingConditions) return null;
  const conditions = startingConditions.length > 0
    ? startingConditions
    : [{ name: "Deploy as researched (default)" }];
  const multiple = conditions.length > 1;
  const numbers = scenarioData ? describeStartingConditions(scenarioData, startingConditions) : "";

  return (
    <div
      className="muted"
      style={{
        fontSize: 12, margin: "0 0 0.75rem", padding: "0.5rem 0.6rem",
        border: "1px solid currentColor", borderRadius: 4, borderLeftWidth: 3,
      }}
    >
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", opacity: 0.7 }}>
        Running experiment{multiple ? ` — ${conditions.length} conditions combined` : ""}
      </div>
      {!multiple ? (
        <>
          <strong>{scenarioName}</strong>
          {conditions[0].name && <> — {conditions[0].name}</>}
          {conditions[0].description && (
            <div style={{ marginTop: "0.2rem", opacity: 0.85 }}>{conditions[0].description}</div>
          )}
        </>
      ) : (
        <>
          <strong>{scenarioName}</strong>
          {conditions.map((c, i) => (
            <div key={c.name ?? i} style={{ marginTop: "0.3rem" }}>
              <strong>{i + 1}. {c.name}</strong>
              {c.description && <div style={{ marginTop: "0.1rem", opacity: 0.85 }}>{c.description}</div>}
            </div>
          ))}
        </>
      )}
      {numbers && (
        <div style={{ marginTop: "0.4rem", paddingTop: "0.4rem", borderTop: "1px solid currentColor", opacity: 0.85 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", opacity: 0.7, marginBottom: "0.15rem" }}>
            Starting values
          </div>
          <div style={{ fontFamily: "monospace" }}>{numbers}</div>
        </div>
      )}
    </div>
  );
}

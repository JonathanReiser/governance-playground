/**
 * Which experiment is actually running, shown identically everywhere a
 * visitor might be looking at a run's output — the deploy screens and
 * every phase of "watch it play out" — not just at the moment it was
 * picked. Feedback that prompted this: after watching agents reason
 * through several cycles, there was no reminder anywhere on screen of
 * which starting condition/variable this particular run was testing,
 * so the numbers and reasoning had nothing to anchor to once you'd
 * scrolled a screen or two past the picker.
 *
 * `startingCondition` is whatever a caller already has on hand — at
 * minimum `{ name }`; `description` is shown when present. Renders
 * nothing if `startingCondition` itself is missing (e.g. still loading),
 * rather than an empty or misleading banner.
 */
export function ExperimentBanner({ scenarioName, startingCondition }) {
  if (!startingCondition) return null;
  return (
    <div
      className="muted"
      style={{
        fontSize: 12, margin: "0 0 0.75rem", padding: "0.5rem 0.6rem",
        border: "1px solid currentColor", borderRadius: 4, borderLeftWidth: 3,
      }}
    >
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", opacity: 0.7 }}>
        Running experiment
      </div>
      <strong>{scenarioName}</strong>
      {startingCondition.name && <> — {startingCondition.name}</>}
      {startingCondition.description && (
        <div style={{ marginTop: "0.2rem", opacity: 0.85 }}>{startingCondition.description}</div>
      )}
    </div>
  );
}

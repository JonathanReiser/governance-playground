import { NON_STATUS_DECISION_KEYS, humanizeKey, deltaColor, sign } from "../lib/cycleRunner";

/**
 * One nation's decision for one cycle, as a real visual card rather than a
 * sentence — flag/name header with its coalition stance, the pre-collapse
 * quantum belief bar (if this call site has one), primary + supporting
 * actions, the AI's own reasoning, colored metric deltas, and any
 * scenario-specific status flags. Originally lived only in AICycleStep.jsx
 * (the wallet-connected, step-by-step researcher tool); pulled out here so
 * LiveRunPanel.jsx's no-wallet "watch it play out" flow can show the exact
 * same rich card instead of a plain-text decision list — see that
 * component's own comment on why "watching a cycle play out" needed more
 * than sentences.
 *
 * `quantumBeliefState`/`instinctReading` are optional and each render
 * `null` when absent (see QuantumBeliefBar/InstinctBar/QpuInstinctBadge
 * below) — the autonomous no-wallet path runs decision → collapse → commit
 * as one atomic step with no evolving pre-collapse belief state to show,
 * unlike the researcher tool's own step-by-step flow. Omitting both props
 * is a supported, first-class use, not a degraded one.
 */

// Two-outcome probability bar for a pre-collapse quantum belief state.
// `belief` = { [labelA]: probA, [labelB]: probB }. Exported separately
// from NationCard too — AICycleStep.jsx also uses it bare, for the
// economic field's own market-instrument belief bars (not a nation, so
// it doesn't go through NationCard at all).
export function QuantumBeliefBar({ belief }) {
  if (!belief) return null;
  const [[labelA, probA], [labelB]] = Object.entries(belief);
  const pctA = Math.round(probA * 100);
  return (
    <div className="quantum-belief">
      <div className="quantum-belief-header">
        <span>⚛ superposition</span>
        <span className="quantum-belief-labels">{labelA.toUpperCase()} {pctA}% · {labelB.toUpperCase()} {100 - pctA}%</span>
      </div>
      <div className="quantum-belief-track">
        <div className="quantum-belief-fill" style={{ width: `${pctA}%` }} />
      </div>
    </div>
  );
}

// Pre-deliberative guardian/royal veto instinct — see lib/instinct.js.
// Distinct visual treatment from QuantumBeliefBar on purpose (amber, not
// indigo): this is upstream of the reasoned belief state above it, not
// another view onto the same thing. entropySource distinguishes a real
// ANU QRNG-sourced reading from the honestly-labeled PRNG fallback —
// never shown as if it were the real thing when it isn't.
function InstinctBar({ reading }) {
  if (!reading) return null;
  const allowPct = Math.round(reading.probabilities.ALLOW * 100);
  const isReal = reading.entropySource === "anu-qrng";
  return (
    <div className="quantum-belief instinct-belief">
      <div className="quantum-belief-header">
        <span>{reading.vetoType === "guardian" ? "🕯 guardian instinct" : "👑 royal instinct"}</span>
        <span className="quantum-belief-labels">VETO {100 - allowPct}% · ALLOW {allowPct}%</span>
      </div>
      <div className="quantum-belief-track">
        <div className="quantum-belief-fill instinct-belief-fill" style={{ width: `${allowPct}%` }} />
      </div>
      <div className={`instinct-entropy ${isReal ? "instinct-entropy--real" : "instinct-entropy--fallback"}`}>
        {isReal ? "⚛ real quantum entropy (ANU QRNG)" : `≈ PRNG fallback — ${reading.entropyDetail ?? "reason not recorded"}`}
      </div>
      {reading.tier === "tier1-fallback" && (
        <div className="instinct-entropy instinct-entropy--fallback">
          ⚠ real IBM hardware was requested but unreachable — {reading.qpuError}
        </div>
      )}
    </div>
  );
}

// Tier 2 — a real (or, on failure, honestly-labeled fallback) IBM
// hardware measurement, see lib/agents.js's proposeInstinctReadingsViaQPU.
// Deliberately NOT a probability bar like InstinctBar: a QPU reading has
// already collapsed by the time it comes back (python-bridge always
// includes a measurement gate) — there's no pre-collapse odds to preview,
// so showing one would misrepresent an already-resolved real measurement
// as a live-updating forecast.
function QpuInstinctBadge({ reading }) {
  if (!reading || reading.tier !== "qpu") return null;
  const isReal = !reading.simulator;
  return (
    <div className="quantum-belief instinct-belief qpu-belief">
      <div className="quantum-belief-header">
        <span>{reading.vetoType === "guardian" ? "🕯 guardian instinct" : "👑 royal instinct"} · measured</span>
        <span className="quantum-belief-labels">{reading.outcome}</span>
      </div>
      <div className={`instinct-entropy ${isReal ? "instinct-entropy--real" : "instinct-entropy--fallback"}`}>
        {isReal
          ? `⚛ real IBM quantum hardware — ${reading.backend}, job ${reading.jobId}`
          : `≈ local simulator fallback — ${reading.detail ?? "reason not recorded"}`}
      </div>
    </div>
  );
}

export function NationCard({ nationId, result, quantumBeliefState, instinctReading, nationMeta, metricLabels }) {
  const meta = nationMeta[nationId];
  const d    = result?.decision;

  if (result?.error) {
    return (
      <div className="nation-card nation-card--error">
        <div className="nation-card-header">
          <span>{meta.flag}</span>
          <span>{meta.label}</span>
        </div>
        <div className="error-box" style={{ marginTop: "0.75rem" }}>{result.error}</div>
      </div>
    );
  }

  if (!d) return null;

  const deltas = d.metricDeltas || {};
  const statusFlags = Object.entries(d).filter(([k, v]) => !NON_STATUS_DECISION_KEYS.has(k) && typeof v === "string");

  return (
    <div className="nation-card" style={{ "--nation-color": meta.color }}>
      <div className="nation-card-header">
        <span className="nation-flag">{meta.flag}</span>
        <span className="nation-name">{meta.label}</span>
        {d.source === "human" && <span className="source-badge">HUMAN</span>}
        <span className="nation-coalition" style={{ color: meta.color }}>
          {d.coalitionSignal || d.coalitionStatus || "—"}
        </span>
      </div>

      <QuantumBeliefBar belief={quantumBeliefState} />
      {instinctReading?.tier === "qpu"
        ? <QpuInstinctBadge reading={instinctReading} />
        : <InstinctBar reading={instinctReading} />}

      <div className="nation-action">
        <span className="action-primary">{d.primaryAction}</span>
        {d.supportingActions?.length > 0 && (
          <span className="action-supporting">
            + {d.supportingActions.join(", ")}
          </span>
        )}
      </div>

      <div className="nation-reasoning">{d.reasoning}</div>

      <div className="nation-deltas">
        {Object.entries(deltas)
          .filter(([k]) => k in metricLabels)
          .map(([k, v]) => (
            <div key={k} className="delta-row">
              <span className="delta-label">{metricLabels[k]}</span>
              <span className="delta-val" style={{ color: deltaColor(v) }}>{sign(v)}</span>
            </div>
          ))}
      </div>

      {/* Nation-specific status flags — rendered generically from whatever
          string fields the decision carries beyond the known shared ones */}
      <div className="nation-status-flags">
        {statusFlags.map(([k, v]) => (
          <span key={k} className="status-flag">{humanizeKey(k)}: {v}</span>
        ))}
        {d.existentialFrameActive && <span className="status-flag status-flag--alert">EXISTENTIAL FRAME</span>}
      </div>

      <div className="nation-research-note muted">{d.researchNote}</div>
    </div>
  );
}

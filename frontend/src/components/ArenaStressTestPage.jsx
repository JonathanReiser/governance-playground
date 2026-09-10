import { useMemo, useState } from "react";
import sweepArtifact from "../data/arenaEntanglementSweep.json";
import { linePath, menuRegimes, regimeAt, validateSweepRecord } from "../lib/ttt/arenaSweep";

const SWEEP = validateSweepRecord(sweepArtifact);
const WIDTH = 760;
const HEIGHT = 300;
const MARGIN = { left: 54, right: 20, top: 18, bottom: 42 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const Y_MAX = 2 / 3;

function xFor(fraction) {
  return MARGIN.left + fraction * PLOT_WIDTH;
}

function yFor(value) {
  return MARGIN.top + (1 - Math.min(Y_MAX, Math.max(0, value)) / Y_MAX) * PLOT_HEIGHT;
}

function payoff(value, signed = false) {
  const displayValue = Math.abs(value) < 5e-4 ? 0 : value;
  const prefix = signed && displayValue > 0 ? "+" : "";
  return `${prefix}${displayValue.toFixed(3)}`;
}

function gammaLabel(point) {
  if (point.gamma_fraction_of_max === 0) return "0 (no entanglement)";
  if (Math.abs(point.gamma_fraction_of_max - 1) < 1e-12) return "π/2 (maximum)";
  return `${point.gamma.toFixed(3)} rad · ${(point.gamma_fraction_of_max * 100).toFixed(1)}% of maximum`;
}

// Derived once: SWEEP is a static build-time artifact, so its regimes are too.
const REGIMES = menuRegimes(SWEEP);

function LegendItem({ className, children }) {
  return <span className="arena-chart-legend-item"><i className={className} />{children}</span>;
}

export function ArenaStressTestPage({ onBack, onPlay }) {
  const [selectedIndex, setSelectedIndex] = useState(SWEEP.points.length - 1);
  const selected = SWEEP.points[selectedIndex];
  const restricted = selected.restricted_menu.responses.X;
  const full = selected.full_su2.responses.X;
  const transition = SWEEP.restricted_menu_transition;
  const activeRegime = regimeAt(SWEEP, selected.gamma_fraction_of_max);

  const paths = useMemo(() => ({
    restricted: linePath(SWEEP.points, (point) => point.restricted_menu.exploitability,
      WIDTH, HEIGHT, MARGIN),
    full: linePath(SWEEP.points, (point) => point.full_su2.exploitability,
      WIDTH, HEIGHT, MARGIN),
  }), []);

  return (
    <section className="ttt-lab arena-stress">
      <div className="arena-topbar">
        <button className="ttt-back" onClick={onBack}>← Governance Playground</button>
        <div className="arena-view-toggle" role="group" aria-label="Quantum Arena view">
          <button onClick={onPlay}>Play arena</button>
          <button className="active" aria-current="page">Strategy stress test</button>
        </div>
      </div>

      <div className="ttt-hero arena-stress-hero">
        <div className="ttt-kicker">Quantum Policy Arena · engineering analysis</div>
        <h1>The same candidate. Two strategy spaces.</h1>
        <p>
          Above a threshold, no listed setting beats <code>Q</code> against <code>Q</code>
          inside the four-setting menu. Give either player every local SU(2) operation and an
          explicit response, <code>iσx</code>, beats it at every entanglement value.
        </p>
        <p className="arena-hero-qualifier">
          That response exists across the whole range, but it only <em>adds</em> information
          above the threshold. Below it the menu already supplies a profitable deviation, so
          both curves sit at two thirds and the wider space reveals nothing further.
        </p>
      </div>

      <div className="arena-summary-grid">
        <article>
          <span><code>Q vs Q</code> under the four-setting menu · at maximum</span>
          <strong className="arena-good">Stable</strong>
          <p>No listed setting gives one player a better payoff. A property of this candidate
            under this domain, not of the game.</p>
        </article>
        <article>
          <span><code>Q vs Q</code> under full SU(2) · at maximum</span>
          <strong className="arena-broken">Broken</strong>
          <p><code>iσx</code> improves either player's payoff by +0.667. Same candidate, wider
            domain of allowed operations.</p>
        </article>
        <article>
          <span><code>Q vs Q</code> becomes stable within the menu</span>
          <strong>{transition.gamma.toFixed(3)} rad</strong>
          <p>{(transition.gamma_fraction_of_max * 100).toFixed(2)}% of maximum entanglement.
            Exact Brent root, not a plotted grid point.</p>
        </article>
      </div>

      <article className="arena-chart-card">
        <div className="arena-chart-header">
          <div>
            <span className="arena-eyebrow">Profitable-deviation sweep</span>
            <h2>How much can one player gain by switching?</h2>
          </div>
          <div className="arena-chart-legend" aria-label="Chart legend">
            <LegendItem className="restricted" >Four-setting menu</LegendItem>
            <LegendItem className="full" >Full SU(2)</LegendItem>
          </div>
        </div>

        <div className="arena-chart-wrap">
          <svg className="arena-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img"
            aria-labelledby="arena-chart-title arena-chart-desc">
            <title id="arena-chart-title">Exploitability over entanglement strength</title>
            <desc id="arena-chart-desc">
              The four-setting exploitability falls from two thirds to zero at 43.59 percent of
              maximum entanglement, a value obtained by Brent root-finding; the plotted curve has
              65 points and brackets that transition without resolving it. Full SU(2)
              exploitability remains two thirds throughout, though at zero entanglement that
              constancy reflects ordinary classical defection rather than any quantum effect.
            </desc>
            {[0, 1 / 3, 2 / 3].map((value) => (
              <g key={value}>
                <line className="arena-gridline" x1={MARGIN.left} x2={WIDTH - MARGIN.right}
                  y1={yFor(value)} y2={yFor(value)} />
                <text className="arena-axis-label" x={MARGIN.left - 10} y={yFor(value) + 4}
                  textAnchor="end">{value.toFixed(2)}</text>
              </g>
            ))}
            <line className="arena-threshold-line" x1={xFor(transition.gamma_fraction_of_max)}
              x2={xFor(transition.gamma_fraction_of_max)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />
            <text className="arena-threshold-label" x={xFor(transition.gamma_fraction_of_max) + 7}
              y={MARGIN.top + 13}>{"Q vs Q becomes stable"}</text>
            <path className="arena-line arena-line-restricted" d={paths.restricted} />
            <path className="arena-line arena-line-full" d={paths.full} />
            <line className="arena-selected-line" x1={xFor(selected.gamma_fraction_of_max)}
              x2={xFor(selected.gamma_fraction_of_max)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />
            <circle className="arena-dot restricted" cx={xFor(selected.gamma_fraction_of_max)}
              cy={yFor(selected.restricted_menu.exploitability)} r="6" />
            <circle className="arena-dot full" cx={xFor(selected.gamma_fraction_of_max)}
              cy={yFor(selected.full_su2.exploitability)} r="6" />
            <text className="arena-axis-label" x={MARGIN.left} y={HEIGHT - 13} textAnchor="middle">0</text>
            <text className="arena-axis-label" x={xFor(0.5)} y={HEIGHT - 13} textAnchor="middle">π/4</text>
            <text className="arena-axis-label" x={WIDTH - MARGIN.right} y={HEIGHT - 13} textAnchor="middle">π/2</text>
            <text className="arena-axis-title" x="15" y={HEIGHT / 2}
              transform={`rotate(-90 15 ${HEIGHT / 2})`} textAnchor="middle">payoff gain</text>
          </svg>
        </div>

        <label className="arena-sweep-control">
          <span><strong>Inspect entanglement</strong><output>{gammaLabel(selected)}</output></span>
          <input type="range" min="0" max={SWEEP.points.length - 1} step="1" value={selectedIndex}
            onChange={(event) => setSelectedIndex(Number(event.target.value))} />
        </label>
      </article>

      <div className="arena-inspector-grid" aria-live="polite">
        <article>
          <span>Candidate payoff</span>
          <strong>{payoff(selected.candidate.payoffs.X)}</strong>
          <p><code>Q vs Q</code> at {gammaLabel(selected)}.</p>
        </article>
        <article>
          <span>Best response in menu</span>
          <strong>{restricted.best_operation}</strong>
          <p>{payoff(selected.restricted_menu.exploitability, true)} gain. {selected.restricted_menu.candidate_is_equilibrium ? "No profitable listed switch." : "The listed menu is not stable here."}</p>
        </article>
        <article>
          <span>Best response in full SU(2)</span>
          <strong>iσx</strong>
          <p>{payoff(selected.full_su2.exploitability, true)} gain, reaching payoff {payoff(full.best_payoff)}.</p>
        </article>
      </div>

      <article className="arena-chart-card arena-regimes">
        <div className="arena-chart-header">
          <div>
            <span className="arena-eyebrow">Menu equilibria across the domain</span>
            <h2>The menu is never without an equilibrium — it changes which one.</h2>
          </div>
        </div>
        <p className="arena-regime-note">
          The threshold above marks where <code>Q vs Q</code> becomes stable, not where the
          menu acquires an equilibrium. It has one throughout; there are three regimes, and
          the middle one has two.
        </p>
        <ol className="arena-regime-list">
          {REGIMES.map((regime) => (
            <li key={regime.label} className={regime === activeRegime ? "active" : ""}>
              <span className="arena-regime-band">
                {(regime.startFraction * 100).toFixed(2)}% – {(regime.endFraction * 100).toFixed(2)}%
              </span>
              <strong>{regime.equilibriaLabel}</strong>
              <small>{regime.description}</small>
            </li>
          ))}
        </ol>
        <p className="arena-regime-note">
          Boundaries are exact Brent roots of best-response crossings
          ({SWEEP.menu_equilibrium_regimes.boundaries.dd_to_asymmetric.gamma.toFixed(6)} and
          {` ${SWEEP.menu_equilibrium_regimes.boundaries.asymmetric_to_qq.gamma.toFixed(6)}`} rad),
          not readings from the {SWEEP.points.length}-point plotted grid.
        </p>
      </article>

      <div className="arena-explanation-grid">
        <article className="arena-explanation">
          <span className="arena-eyebrow">At zero entanglement</span>
          <h2>The deviation is ordinary defection there.</h2>
          <p>
            With no entanglement the referee's operation is the identity, <code>Q</code> becomes
            indistinguishable from <code>C</code>, and <code>iσx</code> lands on <code>D</code>.
            The celebrated <code>+0.667</code> is then just defecting against a cooperating
            opponent in a classical Prisoner's Dilemma — correct arithmetic, no quantum content.
            The red line is flat across the domain for two different reasons, and only its value
            above the threshold says something the menu does not already say.
          </p>
        </article>
        <article className="arena-explanation">
          <span className="arena-eyebrow">In plain language</span>
          <h2>Menu stability is not full-game stability.</h2>
          <p>
            Imagine testing four chess moves and finding that none improves the position. That
            only proves stability among those four moves. SU(2) opens the complete space of
            single-qubit moves; <code>iσx</code> is a legal move that the small menu omitted.
          </p>
        </article>
        <article className="arena-certificate">
          <span className="arena-eyebrow">Why the red line is certified</span>
          <div className="arena-matrix" aria-label="i sigma x matrix">
            <span>[</span><code>0&nbsp;&nbsp;i<br />i&nbsp;&nbsp;0</code><span>]</span>
          </div>
          <p>
            Against <code>Q</code>, this operation produces the deviator-favouring outcome with
            100% exact-simulator probability. Its payoff is 2/3—the highest entry in the frozen
            payoff table—so no unseen operation can beat it.
          </p>
        </article>
      </div>

      <p className="ttt-boundary">
        <strong>Scientific boundary:</strong> {SWEEP.claim_boundary} The sweep contains
        {` ${SWEEP.points.length}`} exact grid points and is generated by the Python reference,
        not fitted to participant plays.
      </p>
    </section>
  );
}

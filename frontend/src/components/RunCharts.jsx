import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// history entries name their committed metrics with SHORT keys (stability,
// proxy, trade, conflicts, dealIntegrity — see cycleRunner.js's own
// computeCommittedMetrics()), a different convention from the LONG
// camelCase keys a decision's metricDeltas use (proxyActivity, tradeVolume,
// conflictEvents — see cycleRunner.js's exported METRIC_ID_TO_KEY, which
// NationCard.jsx uses instead). This chart needs the short-key mapping to
// match `history`'s actual field names, not the long-key one.
const METRIC_ID_TO_KEY = {
  stability_index: "stability",
  proxy_activity:  "proxy",
  trade_volume:    "trade",
  conflict_events: "conflicts",
  deal_integrity:  "dealIntegrity",
};

// Same 4-slot palette regardless of which real-world instruments fill the
// slots — see scenario.aiAgents.marketInstruments for what "primary"/
// "currencyA"/"currencyB"/"global" mean in a given scenario.
const MARKET_COLORS = { primary: "#f97316", currencyA: "#22c55e", currencyB: "#818cf8", global: "#ef4444" };

// Grid/axis/tooltip use the app's own dark-theme CSS variables (App.css's
// :root — this app has no light mode, unlike the marketing site's
// index.css) rather than hardcoded hex, so a chart that shows up in a new
// place automatically matches whatever surface it's dropped onto.
const GRID_STROKE = "var(--border)";
const AXIS_STROKE = "var(--muted)";
const TOOLTIP_STYLE = { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6 };
const TOOLTIP_LABEL_STYLE = { color: "var(--muted)" };

/**
 * The two trajectory charts (political metrics 0-100, and the separate
 * economic index field) shared between AIResultsStep.jsx (the wallet-
 * connected researcher tool's end-of-run summary) and LiveRunPanel.jsx
 * (the no-wallet "watch it play out" flow's LIVE view — same charts,
 * just re-rendered as `history` grows one cycle at a time instead of
 * appearing once at the end). Originally lived only in AIResultsStep.jsx;
 * pulled out here rather than duplicated so both places stay pixel-
 * identical instead of two hand-kept-in-sync copies.
 *
 * Two separate charts, not one, because political metrics (0-100) and
 * the economic index field (0-300, 100 = baseline) don't share a scale —
 * combining them would mean either a dual-axis chart (misleading: two
 * different y-scales invite comparing lines that aren't comparable) or
 * squashing one series flat. `conflict_events` (0-999) and `trade_volume`
 * (0-500) are deliberately left off the political chart for the same
 * reason; they don't share the 0-100 axis stability/dealIntegrity/proxy do.
 *
 * `history` entries need only `.cycle`, the METRIC_ID_TO_KEY-named fields
 * (`.stability`/`.dealIntegrity`/`.proxy`), and `.market.{primary,
 * currencyA,currencyB,global}` — both call sites' history shapes already
 * match this (LiveRunPanel's snapshot object; AIResultsStep's `results.history`).
 * Renders nothing until at least one cycle exists, rather than an empty
 * axis grid that looks broken before a run has any data.
 */
export function RunCharts({ history, scenario }) {
  if (!history || history.length === 0) return null;

  const metricLabels = Object.fromEntries(
    scenario.simulation.metrics
      .map((m) => [METRIC_ID_TO_KEY[m.id], m.name])
      .filter(([key]) => key)
  );

  const chartData = history.map((h) => ({
    cycle: h.cycle, stability: h.stability ?? h.committed?.stability,
    dealIntegrity: h.dealIntegrity ?? h.committed?.dealIntegrity,
    proxy: h.proxy ?? h.committed?.proxy,
  }));

  const marketData = history.map((h) => {
    const market = h.market?.primary !== undefined ? h.market : h.committed?.market;
    return {
      cycle: h.cycle,
      primary: market?.primary, currencyA: market?.currencyA,
      currencyB: market?.currencyB, global: market?.global,
    };
  });

  const { marketInstruments } = scenario.aiAgents;

  return (
    <>
      <section className="section">
        <h3>Political Trajectory</h3>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="cycle" label={{ value: "Cycle", position: "insideBottom", offset: -2 }} stroke={AXIS_STROKE} />
              <YAxis domain={[0, 100]} stroke={AXIS_STROKE} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} />
              <Legend />
              <Line type="monotone" dataKey="stability"     stroke="#6366f1" strokeWidth={2} dot={false} name={metricLabels.stability} isAnimationActive={false} />
              <Line type="monotone" dataKey="dealIntegrity" stroke="#eab308" strokeWidth={2} dot={false} name={metricLabels.dealIntegrity} isAnimationActive={false} />
              <Line type="monotone" dataKey="proxy"         stroke="#ef4444" strokeWidth={2} dot={false} name={metricLabels.proxy} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="section">
        <h3>Economic Field (Layer 2/3)</h3>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={marketData} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="cycle" stroke={AXIS_STROKE} />
              <YAxis stroke={AXIS_STROKE} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} />
              <Legend />
              {marketInstruments.map((inst) => (
                <Line key={inst.key} type="monotone" dataKey={inst.key} stroke={MARKET_COLORS[inst.key]} strokeWidth={2} dot={false} name={inst.label} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </>
  );
}

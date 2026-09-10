export const SWEEP_SCHEMA = "quantum-arena-entanglement-sweep/v0.1";

export function validateSweepRecord(record) {
  if (record?.schema !== SWEEP_SCHEMA) throw new TypeError(`expected ${SWEEP_SCHEMA}`);
  if (!Array.isArray(record.points) || record.points.length < 3) throw new TypeError("sweep points are missing");
  if (record.points.some((point) => !Number.isFinite(point?.gamma_fraction_of_max))) {
    throw new TypeError("sweep contains an invalid gamma coordinate");
  }
  if (record.points.some((point) => !Number.isFinite(point?.restricted_menu?.exploitability)
    || !Number.isFinite(point?.full_su2?.exploitability))) {
    throw new TypeError("sweep contains an invalid exploitability value");
  }
  return record;
}

export function nearestSweepIndex(points, fraction) {
  if (!Array.isArray(points) || points.length === 0) throw new TypeError("points must not be empty");
  const target = Math.min(1, Math.max(0, Number(fraction)));
  let bestIndex = 0;
  let bestDistance = Infinity;
  points.forEach((point, index) => {
    const distance = Math.abs(point.gamma_fraction_of_max - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export function linePath(points, valueFor, width, height, margin) {
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const yMaximum = 2 / 3;
  return points.map((point, index) => {
    const x = margin.left + point.gamma_fraction_of_max * plotWidth;
    const value = Math.min(yMaximum, Math.max(0, valueFor(point)));
    const y = margin.top + (1 - value / yMaximum) * plotHeight;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}


/**
 * Human-readable label for a menu equilibrium profile, e.g. ["D","Q"] -> "D vs Q".
 */
export function formatProfile(profile) {
  if (!Array.isArray(profile) || profile.length !== 2) throw new TypeError("profile must be a pair");
  return `${profile[0]} vs ${profile[1]}`;
}

/**
 * The three pure-equilibrium regimes of the frozen menu, ready for display.
 *
 * Reported separately from the candidate's own stability because the menu game
 * has equilibria at EVERY gamma — which ones changes twice. Showing only
 * `(Q,Q)`'s status invites reading "stabilises" as "had no equilibrium before".
 */
export function menuRegimes(record) {
  const regimes = record?.menu_equilibrium_regimes?.regimes;
  if (!Array.isArray(regimes) || regimes.length !== 3) {
    throw new TypeError("sweep is missing its three menu equilibrium regimes");
  }
  return regimes.map((regime) => ({
    ...regime,
    equilibriaLabel: regime.equilibria.map(formatProfile).join(" and "),
    startFraction: regime.gamma_min / (Math.PI / 2),
    endFraction: regime.gamma_max / (Math.PI / 2),
  }));
}

/**
 * Which regime a gamma fraction falls in. Boundaries are exact Brent roots, so a
 * point may sit inside a regime the 65-point grid cannot resolve.
 */
export function regimeAt(record, fraction) {
  const regimes = menuRegimes(record);
  return regimes.find((regime) => fraction < regime.endFraction) ?? regimes[regimes.length - 1];
}

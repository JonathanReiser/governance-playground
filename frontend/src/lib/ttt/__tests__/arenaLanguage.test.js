import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sweep from "../../../data/arenaEntanglementSweep.json";
import { formatProfile, menuRegimes, regimeAt } from "../arenaSweep";

const PAGE = readFileSync(
  fileURLToPath(new URL("../../../components/ArenaStressTestPage.jsx", import.meta.url)),
  "utf8",
);

const HALF_PI = Math.PI / 2;

describe("corrected Arena presentation language", () => {
  it("no longer says entanglement PROTECTS the candidate", () => {
    // "protects" attributes agency to entanglement and implies a robustness the
    // result does not have. Nothing is protected; the menu omits the winning move.
    expect(PAGE).not.toMatch(/protects?\s+<code>Q vs Q<\/code>/i);
    expect(PAGE).not.toMatch(/entanglement\s+(?:eventually\s+)?protects/i);
  });

  it("no longer claims the MENU stabilizes, only that the candidate does", () => {
    // The menu game has an equilibrium at every gamma. "menu stabilizes" implies
    // it had none below the threshold, which is false.
    expect(PAGE).not.toMatch(/menu stabilizes/i);
    expect(PAGE).toMatch(/Q vs Q becomes stable/);
  });

  it("scopes the SU(2) result to where it adds information", () => {
    expect(PAGE).toMatch(/only <em>adds<\/em> information/i);
    expect(PAGE).toMatch(/both curves sit at two thirds/i);
  });

  it("explains that the zero-entanglement deviation is classical defection", () => {
    expect(PAGE).toMatch(/ordinary defection/i);
    expect(PAGE).toMatch(/no quantum content/i);
    expect(PAGE).toMatch(/indistinguishable from <code>C<\/code>/);
  });

  it("qualifies Stable and Broken as properties of the candidate, not the game", () => {
    expect(PAGE).toMatch(/A property of this candidate\s*\n?\s*under this domain, not of the game/);
    expect(PAGE).toMatch(/Same candidate, wider/);
  });

  it("distinguishes the plotted grid from the Brent-solved exact threshold", () => {
    expect(PAGE).toMatch(/Exact Brent root, not a plotted grid point/);
    expect(PAGE).toMatch(/brackets that transition without resolving it/);
  });

  it("keeps the claim boundary intact", () => {
    expect(PAGE).toMatch(/SWEEP\.claim_boundary/);
    expect(sweep.claim_boundary).toMatch(/not participant data/i);
    expect(sweep.claim_boundary).toMatch(/evidence for or against quantum cognition/i);
    expect(sweep.engineering_only).toBe(true);
    expect(sweep.preregistered_experiment).toBe(false);
  });
});

describe("menu equilibrium regimes", () => {
  it("reports exactly three regimes with the documented occupants", () => {
    const regimes = menuRegimes(sweep);
    expect(regimes.map((r) => r.equilibriaLabel)).toEqual([
      "D vs D",
      "D vs Q and Q vs D",
      "Q vs Q",
    ]);
  });

  it("places the boundaries at the exact Brent roots, not grid points", () => {
    const { dd_to_asymmetric: lower, asymmetric_to_qq: upper } =
      sweep.menu_equilibrium_regimes.boundaries;
    // arctan(1/2) and the sin^2 = 2/5 threshold.
    expect(lower.gamma).toBeCloseTo(Math.atan(0.5), 9);
    expect(Math.sin(upper.gamma) ** 2).toBeCloseTo(0.4, 9);
    // Neither boundary coincides with a plotted grid point.
    const spacing = HALF_PI / (sweep.points.length - 1);
    for (const boundary of [lower.gamma, upper.gamma]) {
      const distance = Math.abs(boundary / spacing - Math.round(boundary / spacing));
      expect(distance).toBeGreaterThan(1e-6);
    }
  });

  it("covers the domain contiguously with no gap or overlap", () => {
    const regimes = menuRegimes(sweep);
    expect(regimes[0].gamma_min).toBe(0);
    expect(regimes.at(-1).gamma_max).toBeCloseTo(HALF_PI, 12);
    for (let i = 1; i < regimes.length; i += 1) {
      expect(regimes[i].gamma_min).toBeCloseTo(regimes[i - 1].gamma_max, 12);
    }
  });

  it("the middle band genuinely holds TWO equilibria", () => {
    // This is the fact the old "menu stabilizes" label hid.
    expect(menuRegimes(sweep)[1].equilibria).toHaveLength(2);
    expect(menuRegimes(sweep)[1].description).toMatch(/coordination/i);
  });

  it("locates a gamma in the right regime", () => {
    expect(regimeAt(sweep, 0.05).equilibriaLabel).toBe("D vs D");
    expect(regimeAt(sweep, 0.36).equilibriaLabel).toBe("D vs Q and Q vs D");
    expect(regimeAt(sweep, 0.99).equilibriaLabel).toBe("Q vs Q");
  });

  it("agrees with the per-point equilibria recorded in the sweep", () => {
    for (const point of sweep.points) {
      const expected = regimeAt(sweep, point.gamma_fraction_of_max).equilibria;
      const actual = point.restricted_menu.menu_equilibria;
      // Grid points exactly on a boundary may legitimately straddle; allow those.
      const onBoundary = menuRegimes(sweep).some((r) =>
        Math.abs(point.gamma - r.gamma_min) < 1e-9 || Math.abs(point.gamma - r.gamma_max) < 1e-9);
      if (!onBoundary) expect(actual).toEqual(expected);
    }
  });

  it("rejects a malformed profile rather than rendering nonsense", () => {
    expect(() => formatProfile(["D"])).toThrow(/pair/);
    expect(() => formatProfile(null)).toThrow(/pair/);
  });
});

import { describe, expect, it } from "vitest";
import sweep from "../../../data/arenaEntanglementSweep.json";
import { linePath, nearestSweepIndex, validateSweepRecord } from "../arenaSweep";

describe("arena entanglement sweep artifact", () => {
  it("is the separate engineering schema and carries its claim boundary", () => {
    expect(validateSweepRecord(sweep)).toBe(sweep);
    expect(sweep.engineering_only).toBe(true);
    expect(sweep.preregistered_experiment).toBe(false);
    expect(sweep.claim_boundary).toMatch(/not participant data/i);
  });

  it("shows the restricted transition without hiding the full-space failure", () => {
    expect(sweep.points[0].restricted_menu.exploitability).toBeCloseTo(2 / 3, 12);
    expect(sweep.points.at(-1).restricted_menu.exploitability).toBeCloseTo(0, 12);
    for (const point of sweep.points) {
      expect(point.full_su2.exploitability).toBeCloseTo(2 / 3, 12);
    }
    expect(sweep.full_su2_certificate.certified_at_every_grid_point).toBe(true);
  });

  it("selects the nearest bounded point and makes finite chart paths", () => {
    expect(nearestSweepIndex(sweep.points, -1)).toBe(0);
    expect(nearestSweepIndex(sweep.points, 2)).toBe(sweep.points.length - 1);
    const middle = nearestSweepIndex(sweep.points, 0.5);
    expect(sweep.points[middle].gamma_fraction_of_max).toBeCloseTo(0.5, 2);
    const path = linePath(sweep.points, (point) => point.full_su2.exploitability,
      760, 300, { left: 54, right: 20, top: 18, bottom: 42 });
    expect(path).toMatch(/^M\d/);
    expect(path).not.toMatch(/NaN|Infinity/);
  });
});


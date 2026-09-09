const { expect } = require("chai");
const { hashRecord } = require("../server/prereg");
const { createArenaRegistration, sealArenaResult, verifyArenaResult } = require("../server/arenaPrereg");

const HOUR = 3_600_000;
const HALF_PI = Math.PI / 2;

const BASIS = {
  method: "Aer noise-model prediction, computed before registration",
  worst_predicted_tvd: 0.063,
  threshold: 0.18,
};

const CELLS = [
  { operationX: "C", operationO: "D", gamma: 0 },
  { operationX: "Q", operationO: "Q", gamma: HALF_PI },
];

function makeRegistration(overrides = {}) {
  return createArenaRegistration({
    cells: CELLS,
    shotsPerCell: 4096,
    backend: "ibm_marrakesh",
    tvdThreshold: 0.18,
    thresholdBasis: BASIS,
    drawAfterMs: Date.now() + HOUR,
    ...overrides,
  });
}

const BEACON = {
  pulseIndex: 999,
  timeStamp: new Date(Date.now() + 2 * HOUR).toISOString(),
  outputValue: "ABC123",
  uri: "https://beacon.nist.gov/x",
};

function cell(overrides = {}) {
  return {
    operationX: "C", operationO: "D", gamma: 0,
    counts: { CC: 0, CD: 4096, DC: 0, DD: 0 },
    tvd: 0.02, shots: 4096, simulator: false, backend: "ibm_marrakesh", job_id: "j1",
    ...overrides,
  };
}

describe("arena preregistration", () => {
  it("refuses a drawAfter that has already passed", () => {
    // The entire point is binding to entropy that does not exist yet.
    expect(() => makeRegistration({ drawAfterMs: Date.now() - HOUR })).to.throw(/does not exist yet/);
  });

  it("refuses a threshold with no recorded basis", () => {
    // A threshold with no derivation is a number chosen after seeing something.
    expect(() => makeRegistration({ thresholdBasis: undefined })).to.throw(/how the threshold was derived/);
    expect(() => makeRegistration({ thresholdBasis: { worst: 0.06 } })).to.throw(/how the threshold was derived/);
  });

  it("refuses an empty cell list and a nonsense threshold", () => {
    expect(() => makeRegistration({ cells: [] })).to.throw(/at least one cell/);
    expect(() => makeRegistration({ tvdThreshold: 0 })).to.throw(/between 0 and 1/);
    expect(() => makeRegistration({ tvdThreshold: 1.5 })).to.throw(/between 0 and 1/);
  });

  it("records the pin and states that least_busy is not used", () => {
    const { record } = makeRegistration();
    expect(record.backend).to.equal("ibm_marrakesh");
    expect(record.backendSelection).to.match(/least_busy is not used/);
  });

  it("sorts cells so the hash does not depend on the order they were listed", () => {
    const forward = makeRegistration({ cells: CELLS });
    const reversed = makeRegistration({ cells: [...CELLS].reverse(), drawAfterMs: Date.parse(forward.record.drawAfter) });
    expect(reversed.record.cells).to.deep.equal(forward.record.cells);
  });

  describe("verification", () => {
    async function verify(resultOverrides = {}, registrationOverrides = {}) {
      const { record: registration } = makeRegistration(registrationOverrides);
      const hash = hashRecord(registration);
      const { record: result } = sealArenaResult({
        registrationHash: hash, beacon: BEACON,
        cells: [cell(), cell({ operationX: "Q", operationO: "Q", gamma: HALF_PI, tvd: 0.05 })],
        backendReported: "ibm_marrakesh",
        ...resultOverrides,
      });
      return verifyArenaResult({ registration, result: { ...result, ...resultOverrides }, liveBeaconCheck: false });
    }

    it("passes a clean result", async () => {
      const report = await verify();
      expect(report.verified).to.equal(true);
      expect(report.hypothesisUpheld).to.equal(true);
    });

    it("catches a result that ran on a different backend than was pinned", async () => {
      const report = await verify({ backendReported: "ibm_fez" });
      const check = report.checks.find((c) => c.name.includes("backend that ran"));
      expect(check.ok).to.equal(false);
    });

    it("refuses simulator output published as a hardware result", async () => {
      const report = await verify({ cells: [cell({ simulator: true })] });
      expect(report.checks.find((c) => c.name.includes("simulator")).ok).to.equal(false);
    });

    it("catches cells being dropped from the published result", async () => {
      // Publishing only the cells that came out well is the failure mode the
      // commitment exists to prevent.
      const report = await verify({ cells: [cell()] });
      expect(report.checks.find((c) => c.name.includes("every registered cell")).ok).to.equal(false);
    });

    it("catches a shot count that does not match the registration", async () => {
      const report = await verify({ cells: [cell({ shots: 512 }), cell({ shots: 512 })] });
      expect(report.checks.find((c) => c.name.includes("shot counts")).ok).to.equal(false);
    });

    it("catches a tampered chain hash", async () => {
      const report = await verify({ chain: "0".repeat(64) });
      expect(report.checks.find((c) => c.name.includes("chain hash")).ok).to.equal(false);
    });

    it("falsifies on a SINGLE bad cell, not on the average", async () => {
      // Two cells: one far over threshold, one far under. The mean would pass.
      const report = await verify({
        cells: [cell({ tvd: 0.30 }), cell({ operationX: "Q", operationO: "Q", gamma: HALF_PI, tvd: 0.02 })],
      });
      expect((0.30 + 0.02) / 2).to.be.below(0.18); // 0.16 — the average would have passed
      expect(0.30).to.be.above(0.18);              // but this cell alone falsifies it
      expect(report.hypothesisUpheld).to.equal(false);
      expect(report.cellsExceedingThreshold).to.have.lengthOf(1);
    });
  });
});

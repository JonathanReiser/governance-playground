const { expect } = require("chai");
const {
  canonicalStringify, hashRecord, createRegistration, sealRun, verifyRun, fetchBeaconAtOrAfter,
} = require("../server/prereg");

const DOCTRINE = { iran: "doctrine text A", israel: "doctrine text B" };
const SCHEMAS = { iran: { type: "object" }, israel: { type: "object" } };
const HOUR = 3_600_000;

function makeRegistration(overrides = {}) {
  return createRegistration({
    scenarioId: "middle-east-2026", cycles: 2, mode: "ai-quantum-tier1",
    agentModel: "claude-opus-5", doctrine: DOCTRINE, schemas: SCHEMAS,
    drawAfterMs: Date.now() + HOUR, ...overrides,
  });
}

const BEACON = {
  pulseIndex: 1916199,
  timeStamp: new Date(Date.now() + 2 * HOUR).toISOString(),
  outputValue: "4B7F7AFE7A86AFF0".repeat(8),
  uri: "https://beacon.nist.gov/beacon/2.0/pulse/time/next/1",
};
const CYCLES = [{ cycle: 1, stability: 42 }, { cycle: 2, stability: 39 }];

const beaconFetch = (value = BEACON.outputValue) => async () => ({
  ok: true,
  json: async () => ({ pulse: { ...BEACON, outputValue: value } }),
});

describe("pre-registration", function () {
  describe("canonical serialization", function () {
    it("hashes identically regardless of key insertion order", function () {
      const a = { b: 1, a: { d: 4, c: 3 } };
      const b = { a: { c: 3, d: 4 }, b: 1 };
      expect(canonicalStringify(a)).to.equal(canonicalStringify(b));
      expect(hashRecord(a)).to.equal(hashRecord(b));
    });

    it("still distinguishes genuinely different data", function () {
      expect(hashRecord({ a: 1 })).to.not.equal(hashRecord({ a: 2 }));
    });
  });

  describe("registering", function () {
    it("refuses a draw time that is not in the future", function () {
      expect(() => makeRegistration({ drawAfterMs: Date.now() - 1000 }))
        .to.throw(/must be in the future/);
    });

    it("binds to a beacon pulse that does not exist yet", function () {
      const { record } = makeRegistration();
      expect(record.beaconUri).to.match(/pulse\/time\/next\/\d+$/);
      expect(Date.parse(record.drawAfter)).to.be.greaterThan(Date.now());
    });

    it("pins the model and every prompt's doctrine", function () {
      const { record } = makeRegistration();
      expect(record.agentModel).to.equal("claude-opus-5");
      expect(Object.keys(record.doctrineHashes)).to.deep.equal(["iran", "israel"]);
      expect(record.doctrineHashes.iran).to.have.length(64);
    });

    it("changes hash when any registered parameter changes", function () {
      const base = makeRegistration({ now: 1000, drawAfterMs: 1000 + HOUR });
      const moreCycles = makeRegistration({ now: 1000, drawAfterMs: 1000 + HOUR, cycles: 3 });
      const editedPrompt = makeRegistration({
        now: 1000, drawAfterMs: 1000 + HOUR,
        doctrine: { ...DOCTRINE, iran: "doctrine text A, quietly edited" },
      });
      expect(moreCycles.hash).to.not.equal(base.hash);
      expect(editedPrompt.hash).to.not.equal(base.hash);
    });
  });

  describe("verifying an honest run", function () {
    it("passes every check", async function () {
      const { record: registration, hash } = makeRegistration();
      const { record: result } = sealRun({
        registrationHash: hash, beacon: BEACON, cycles: CYCLES, servedModels: ["claude-opus-5"],
      });
      const report = await verifyRun({ registration, result, fetchImpl: beaconFetch() });
      expect(report.ok, JSON.stringify(report.checks)).to.equal(true);
    });
  });

  describe("catching tampering", function () {
    async function verifyWith(mutate, fetchImpl = beaconFetch()) {
      const { record: registration, hash } = makeRegistration();
      const { record: result } = sealRun({
        registrationHash: hash, beacon: BEACON, cycles: CYCLES, servedModels: ["claude-opus-5"],
      });
      return verifyRun({ registration, result: mutate(result, registration), fetchImpl });
    }
    const failed = (report, name) => {
      const c = report.checks.find((x) => x.name === name);
      expect(c, `missing check: ${name}`).to.exist;
      return c.ok === false && report.ok === false;
    };

    it("catches results edited after sealing", async function () {
      const report = await verifyWith((r) => ({ ...r, cycles: [{ cycle: 1, stability: 99 }] }));
      expect(failed(report, "result chains to registration and entropy")).to.equal(true);
    });

    it("catches a registration edited after the fact", async function () {
      const { record: registration, hash } = makeRegistration();
      const { record: result } = sealRun({
        registrationHash: hash, beacon: BEACON, cycles: CYCLES, servedModels: ["claude-opus-5"],
      });
      const rewritten = { ...registration, cycles: 99 };
      const report = await verifyRun({ registration: rewritten, result, fetchImpl: beaconFetch() });
      expect(failed(report, "registration hash recomputes")).to.equal(true);
    });

    it("catches entropy drawn before the registered time", async function () {
      const early = new Date(Date.now() - HOUR).toISOString();
      const report = await verifyWith((r) => ({ ...r, beacon: { ...r.beacon, timeStamp: early } }));
      expect(failed(report, "pulse is at or after the registered time")).to.equal(true);
    });

    it("catches a beacon value NIST does not corroborate", async function () {
      const report = await verifyWith((r) => r, beaconFetch("00".repeat(64)));
      expect(failed(report, "NIST independently returns the same pulse")).to.equal(true);
    });

    it("catches a run that quietly used a different model", async function () {
      const { record: registration, hash } = makeRegistration();
      const { record: result } = sealRun({
        registrationHash: hash, beacon: BEACON, cycles: CYCLES,
        servedModels: ["claude-opus-5", "claude-opus-4-8"],
      });
      const report = await verifyRun({ registration, result, fetchImpl: beaconFetch() });
      expect(failed(report, "run used the registered model only")).to.equal(true);
    });
  });

  describe("what it refuses to claim", function () {
    it("states the limit in its own output", async function () {
      const { record: registration, hash } = makeRegistration();
      const { record: result } = sealRun({
        registrationHash: hash, beacon: BEACON, cycles: CYCLES, servedModels: ["claude-opus-5"],
      });
      const report = await verifyRun({ registration, result, fetchImpl: beaconFetch() });
      expect(report.doesNotProve).to.match(/no other runs were executed/);
      expect(report.doesNotProve).to.match(/not reproducible/);
    });
  });

  describe("beacon client", function () {
    it("asks for the pulse at or after a time, not the latest one", async function () {
      let asked;
      await fetchBeaconAtOrAfter(1787590540291, {
        fetchImpl: async (uri) => { asked = uri; return { ok: true, json: async () => ({ pulse: BEACON }) }; },
      });
      expect(asked).to.equal("https://beacon.nist.gov/beacon/2.0/pulse/time/next/1787590540291");
    });

    it("throws rather than falling back to a PRNG", async function () {
      let threw = false;
      try {
        await fetchBeaconAtOrAfter(1, { fetchImpl: async () => ({ ok: false, status: 503 }) });
      } catch (err) { threw = /503/.test(err.message); }
      expect(threw, "a pre-registration must never seed itself from Math.random").to.equal(true);
    });
  });
});

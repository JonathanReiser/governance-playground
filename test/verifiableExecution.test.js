const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { PROTOCOL, MAX_BYTES, canonicalize, parseCanonical, digest, commit, createEvidence, verify } = require("../server/verifiableExecution");
const demo = require("../examples/verifiable-execution/synthetic-workflow");
const { report } = require("../scripts/verifiable-execution");
const clone = value => JSON.parse(JSON.stringify(value));
function setup() {
  const manifest = demo.makeManifest("test-execution-001", "2026-09-15T00:00:00.000Z");
  const expectedCommitment = commit(manifest);
  return { manifest, expectedCommitment, expectedExecutionId: manifest.executionId, evidence: demo.execute(manifest, expectedCommitment) };
}
function reseal(evidence) {
  const { evidenceHash, ...body } = evidence;
  return createEvidence(body);
}
function fails(bundle, field) {
  const result = verify(bundle);
  assert.equal(result.status, "FAIL");
  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some(m => m.path === field), JSON.stringify(result));
}

describe("verifiable execution v0", function () {
  it("unchanged execution passes and states its limited claim", function () {
    const result = verify(setup());
    assert.equal(result.status, "PASS");
    assert.match(result.claim, /Presented evidence conforms/);
    assert.match(result.limitations, /no proof of actual execution/);
  });
  it("actual threshold 0.75 fails against 0.72 and changes output", function () {
    const b = setup();
    const honest = b.evidence;
    b.evidence = demo.execute(b.manifest, b.expectedCommitment, 0.75);
    assert.notDeepEqual(b.evidence.output, honest.output);
    fails(b, "/specification/parameters/threshold");
  });
  for (const [section, key, value] of [
    ["model", "version", "2"], ["model", "hash", "a".repeat(64)],
    ["inputs", "hash", "b".repeat(64)], ["policy", "version", "2"],
    ["policy", "hash", "c".repeat(64)], ["approval", "hash", "d".repeat(64)],
    ["code", "hash", "e".repeat(64)], ["workflow", "version", "2"],
  ]) {
    it(`changed ${section}.${key} fails even with recomputed evidence digest`, function () {
      const b = setup();
      b.evidence.observedSpecification[section][key] = value;
      b.evidence = reseal(b.evidence);
      fails(b, `/specification/${section}/${key}`);
    });
  }
  it("manifest modified after commitment fails", function () {
    const b = setup();
    b.manifest.specification.parameters.threshold = 0.75;
    fails(b, "/manifest");
    fails(b, "/specification/parameters/threshold");
  });
  it("rewriting manifest AND evidence cannot replace the retained commitment", function () {
    const b = setup();
    b.manifest.specification.parameters.threshold = 0.75;
    b.evidence = demo.execute(b.manifest, commit(b.manifest));
    fails(b, "/manifest");
    fails(b, "/evidence/commitment");
  });
  it("execution associated with wrong commitment fails", function () {
    const b = setup();
    b.evidence.commitment = "0".repeat(64);
    b.evidence = reseal(b.evidence);
    fails(b, "/evidence/commitment");
  });
  it("replay across verifier execution contexts fails", function () {
    const b = setup();
    b.expectedExecutionId = "another-execution";
    fails(b, "/manifest/executionId");
    fails(b, "/evidence/executionId");
  });
  it("changing just the evidence execution ID fails", function () {
    const b = setup();
    b.evidence.executionId = "another-execution";
    b.evidence = reseal(b.evidence);
    fails(b, "/evidence/executionId");
  });
  it("explicitly does not detect repeated presentation of the identical bundle", function () {
    const b = setup();
    assert.equal(verify(b).ok, true);
    assert.equal(verify(b).ok, true); // caller needs durable consumed-ID state for single use
  });
  it("requires independent full commitment and execution context", function () {
    for (const key of ["expectedCommitment", "expectedExecutionId"]) {
      const b = setup(); delete b[key]; fails(b, "/");
    }
    const b = setup(); b.expectedCommitment = b.expectedCommitment.slice(0, 16); fails(b, "/");
  });
  it("missing and unexpected nested fields fail with paths", function () {
    const b = setup();
    delete b.evidence.observedSpecification.model.hash;
    b.evidence.observedSpecification.parameters.extra = true;
    b.evidence = reseal(b.evidence);
    fails(b, "/specification/model/hash");
    fails(b, "/specification/parameters/extra");
  });
  it("binds all extension fields including nested arrays and null", function () {
    const b = setup();
    b.manifest.specification.extension = { sequence: [1, 2], note: null };
    b.expectedCommitment = commit(b.manifest);
    b.evidence.observedSpecification = clone(b.manifest.specification);
    b.evidence.commitment = b.expectedCommitment;
    b.evidence = reseal(b.evidence);
    assert.equal(verify(b).ok, true);
    b.evidence.observedSpecification.extension.sequence.reverse();
    b.evidence = reseal(b.evidence);
    fails(b, "/specification/extension/sequence/0");
  });
  it("fails closed for absent or null API options", function () {
    assert.equal(verify().status, "FAIL");
    assert.equal(verify(null).status, "FAIL");
  });
  it("rejects malformed or unsupported protocol envelopes", function () {
    for (const mutate of [b => { b.evidence.protocol = "v99"; }, b => { b.manifest.protocol = "v99"; },
      b => { b.evidence.extra = true; }, b => { b.manifest.extra = true; },
      b => { delete b.evidence.output; }, b => { b.evidence = null; },
      b => { b.manifest.createdAt = "2026-02-30T00:00:00.000Z"; }]) {
      const b = setup(); mutate(b); fails(b, "/");
    }
  });
  it("output edits break the evidence digest, but resealing is not authentication", function () {
    const b = setup();
    b.evidence.output[0].decision = "fabricated";
    fails(b, "/evidence/evidenceHash");
    b.evidence = reseal(b.evidence);
    assert.equal(verify(b).ok, true); // core compares spec, not arbitrary workflow semantics
    const result = report(b.manifest, b.evidence, b.expectedCommitment, b.expectedExecutionId, true);
    assert.equal(result.ok, false); // demo-specific deterministic replay detects this
    assert.ok(result.mismatches.some(m => m.path === "/output/0/decision"));
  });
  it("does not treat backdated timestamps as trustworthy evidence of timing", function () {
    const b = setup();
    b.evidence.completedAt = "2000-01-01T00:00:00.000Z";
    b.evidence = reseal(b.evidence);
    const result = verify(b);
    assert.equal(result.ok, true);
    assert.match(result.limitations, /Timestamps are operator assertions/);
  });
  it("detects mutations to every leaf of the demo specification", function () {
    const leaves = [];
    function walk(value, parts = []) {
      if (value !== null && typeof value === "object") {
        for (const key of Object.keys(value)) walk(value[key], [...parts, key]);
      } else leaves.push(parts);
    }
    walk(setup().manifest.specification);
    for (const parts of leaves) {
      const b = setup();
      let parent = b.evidence.observedSpecification;
      for (const key of parts.slice(0, -1)) parent = parent[key];
      const key = parts.at(-1);
      parent[key] = typeof parent[key] === "number" ? parent[key] + 0.01 : parent[key] + "-changed";
      b.evidence = reseal(b.evidence);
      fails(b, "/specification/" + parts.join("/"));
    }
  });
  it("does not print committed or observed values in mismatch reports", function () {
    const b = setup();
    b.evidence.observedSpecification.model.version = "sensitive-value-do-not-print";
    b.evidence = reseal(b.evidence);
    assert.ok(!JSON.stringify(verify(b)).includes("sensitive-value-do-not-print"));
  });
  it("does not claim detection of an operator fabricating a conforming transcript", function () {
    const b = setup();
    const fabricated = createEvidence({ commitment: b.expectedCommitment, executionId: b.expectedExecutionId,
      observedSpecification: b.manifest.specification, output: demo.compute(0.72), completedAt: b.evidence.completedAt });
    assert.equal(verify({ ...b, evidence: fabricated }).ok, true);
    assert.equal(report(b.manifest, fabricated, b.expectedCommitment, b.expectedExecutionId, true).ok, true);
  });
});

describe("v0 canonicalization and wire format", function () {
  it("has a fixed byte/digest vector independent of object-key insertion order", function () {
    const a = { b: 1, a: { d: 4, c: 3 }, "2": "two", "10": "ten" };
    const b = { "10": "ten", "2": "two", a: { c: 3, d: 4 }, b: 1 };
    assert.equal(canonicalize(a), '{"10":"ten","2":"two","a":{"c":3,"d":4},"b":1}');
    assert.equal(canonicalize(a), canonicalize(b));
    assert.equal(digest("artifact", a), digest("artifact", b));
    assert.equal(digest("artifact", a), "b4d2288e57cf5df69929e2aa9423853eccda85cd990f0709cafdf0fd5ea3ff9e");
    assert.notEqual(digest("manifest", a), digest("evidence", a));
  });
  it("retains __proto__ as data and escapes JSON pointer field paths", function () {
    const a = JSON.parse('{"__proto__":{"x":1},"a/b~c":2}');
    assert.equal(canonicalize(a), '{"__proto__":{"x":1},"a/b~c":2}');
    const b = setup();
    b.evidence.observedSpecification["a/b~c"] = 2;
    b.evidence = reseal(b.evidence);
    fails(b, "/specification/a~1b~0c");
    assert.equal({}.x, undefined);
  });
  it("keeps Unicode normalization and value types distinct", function () {
    assert.notEqual(canonicalize("é"), canonicalize("e\u0301"));
    assert.notEqual(canonicalize(0.72), canonicalize("0.72"));
    assert.equal(parseCanonical(canonicalize({ unicode: "😀", control: "\n" })).unicode, "😀");
  });
  it("rejects lossy in-memory JSON values, cycles, getters and hidden properties", function () {
    const cyclic = {}; cyclic.self = cyclic;
    const sparse = []; sparse.length = 1;
    const extra = []; extra.foo = 1;
    const getter = Object.defineProperty({}, "x", { enumerable: true, get() { throw new Error("getter executed"); } });
    for (const v of [undefined, NaN, Infinity, -0, 9007199254740992, 1n, () => 1, new Date(),
      { x: undefined }, [undefined], sparse, extra, cyclic, getter, "\ud800",
      { [Symbol("x")]: 1 }, Object.defineProperty({}, "x", { value: 1 })]) {
      assert.throws(() => canonicalize(v));
    }
    assert.throws(() => canonicalize(getter), /accessors/);
  });
  it("rejects duplicate keys (including escaped aliases) and numeric rounding at the wire boundary", function () {
    for (const text of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"x":-0}',
      '{"x":0.72000000000000001}', '{"x":1e999}', '{"x":9007199254740993}',
      '{"x":"\\ud800"}', '{ "x":1}', '{"x":1}\n\n']) assert.throws(() => parseCanonical(text));
    assert.deepEqual(parseCanonical('{"x":1}\n'), { x: 1 });
  });
  it("rejects excess size and depth", function () {
    assert.throws(() => canonicalize("x".repeat(MAX_BYTES)), /size/);
    let v = 0; for (let i = 0; i < 66; i++) v = [v];
    assert.throws(() => canonicalize(v), /depth/);
  });
  it("preserves a historical preregistration hash and verifies its archived result offline", async function () {
    const legacy = require("../server/prereg");
    const dir = path.join(__dirname, "../preregistrations");
    const registration = JSON.parse(fs.readFileSync(path.join(dir, "67bd00e6150e2ab5.registration.json")));
    const result = JSON.parse(fs.readFileSync(path.join(dir, "67bd00e6150e2ab5.result.json")));
    assert.equal(legacy.hashRecord(registration), result.registrationHash);
    assert.ok(legacy.hashRecord(registration).startsWith("67bd00e6150e2ab5"));
    assert.equal((await legacy.verifyRun({ registration, result, liveBeaconCheck: false })).ok, true);
  });
});

describe("standalone CLI", function () {
  const cli = path.join(__dirname, "../scripts/verifiable-execution.js");
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "verifiable-execution-test-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  it("runs the full demo and independent verification with correct exit statuses", function () {
    const out = path.join(dir, "demo");
    const demoResult = run("demo", out);
    assert.equal(demoResult.status, 0, demoResult.stderr);
    assert.match(demoResult.stdout, /0.72 → 0.72 = VERIFIED/);
    assert.match(demoResult.stdout, /0.72 → 0.75 = VERIFICATION FAILED/);
    const hash = fs.readFileSync(path.join(out, "expected-commitment.txt"), "utf8").trim();
    const id = fs.readFileSync(path.join(out, "expected-execution-id.txt"), "utf8").trim();
    const manifest = path.join(out, "manifest.json");
    assert.equal(run("commit", manifest).stdout.trim(), hash);
    for (const command of ["verify", "verify-demo"]) {
      assert.equal(run(command, manifest, path.join(out, "unchanged.evidence.json"), hash, id).status, 0);
      const fail = run(command, manifest, path.join(out, "tampered.evidence.json"), hash, id);
      assert.equal(fail.status, 1);
      assert.match(fail.stdout, /specification\/parameters\/threshold/);
      assert.equal(run(command, manifest, path.join(out, "unchanged.evidence.json"), "0".repeat(64), id).status, 1);
    }
    const output = path.join(out, "separate.evidence.json");
    assert.equal(run("execute-demo", manifest, hash, output).status, 0);
    assert.equal(run("verify-demo", manifest, output, hash, id).status, 0);
    assert.equal(run("execute-demo", manifest, hash, output).status, 1); // never overwrite
    assert.equal(run("demo", out).status, 1);
  });
  it("verifies from a minimal copy with no research module, demo adapter or npm packages", function () {
    const b = setup();
    fs.mkdirSync(path.join(dir, "server"));
    fs.mkdirSync(path.join(dir, "scripts"));
    for (const file of ["server/sha256.js", "server/verifiableExecution.js", "scripts/verifiable-execution.js"]) {
      fs.copyFileSync(path.join(__dirname, "..", file), path.join(dir, file));
    }
    const manifest = path.join(dir, "manifest.json");
    const evidence = path.join(dir, "evidence.json");
    fs.writeFileSync(manifest, canonicalize(b.manifest));
    fs.writeFileSync(evidence, canonicalize(b.evidence));
    const result = spawnSync(process.execPath, [path.join(dir, "scripts/verifiable-execution.js"),
      "verify", manifest, evidence, b.expectedCommitment, b.expectedExecutionId], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "PASS");
  });
  it("rejects malformed JSON and UTF-8 without leaking input excerpts", function () {
    const file = path.join(dir, "bad.json");
    fs.writeFileSync(file, '{"sensitive":"secret-value-123" oops}');
    let result = run("commit", file);
    assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes("secret-value-123"));
    fs.writeFileSync(file, Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]));
    assert.equal(run("commit", file).status, 1); // BOM is not canonical transport
    fs.writeFileSync(file, Buffer.from([0x22, 0xff, 0x22]));
    result = run("commit", file);
    assert.equal(result.status, 1);
  });
});

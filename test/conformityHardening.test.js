const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const c = require("../server/verifiableConformity");
const demo = require("../examples/verifiable-conformity/synthetic-workflow");
const vectors = require("../examples/verifiable-conformity/canonicalization-vectors.json");
function bundle() {
  const manifest = demo.makeManifest("operator-context", "2026-09-15T00:00:00.000Z");
  const expectedCommitment = c.unsafe.commit(manifest);
  return { manifest, evidence: demo.execute(manifest, expectedCommitment), expectedCommitment,
    expectedExecutionId: manifest.executionId, adapters: demo.adapters };
}
function verify(b, options = {}) {
  return c.verify({ manifestWire: c.canonicalize(b.manifest), evidenceWire: c.canonicalize(b.evidence),
    expectedCommitment: b.expectedCommitment, expectedExecutionId: b.expectedExecutionId, adapters: b.adapters, ...options });
}
function update(b) { b.expectedCommitment = c.unsafe.commit(b.manifest); b.evidence = demo.execute(b.manifest, b.expectedCommitment); }
function reseal(b) { const { evidenceHash, ...body } = b.evidence; b.evidence = c.createEvidence(body); }

describe("adversarial conformity hardening", function () {
  it("H-2 enforces a committed adapter; omission, wrong version, false, exceptions and truthy returns fail", function () {
    const b = bundle();
    assert.equal(verify(b).outputValidation.status, "PASS");
    for (const adapters of [new Map(), new Map([["synthetic-review@2", () => true]]),
      new Map([["synthetic-review@1", () => false]]), new Map([["synthetic-review@1", () => { throw Error("secret-adapter-data"); }]]),
      new Map([["synthetic-review@1", () => ({ ok: true })]]), new Map([["synthetic-review@1", () => Promise.resolve(true)]]), new Map([["synthetic-review@1", () => Promise.reject(Error("secret"))]])]) {
      const result = verify(b, { adapters });
      assert.equal(result.ok, false);
      assert.ok(!JSON.stringify(result).includes("secret-adapter-data"));
    }
  });
  it("H-2 runs a trusted schema predicate and rejects a schema-invalid output after resealing", function () {
    const b = bundle();
    b.manifest.outputConstraint = { type: "adapter", id: "schema", version: "1" };
    b.adapters = new Map([["schema@1", ({ output }) => Array.isArray(output) && output.every(row =>
      Object.keys(row).sort().join(",") === "decision,id,score" && typeof row.id === "string" &&
      typeof row.score === "number" && ["review", "clear"].includes(row.decision))]]);
    update(b);
    assert.equal(verify(b).ok, true);
    b.evidence.output[0].score = "not a number"; reseal(b);
    assert.equal(verify(b).outputValidation.status, "FAIL");
  });
  it("H-2 enforces a committed output digest even after evidence resealing", function () {
    const b = bundle();
    b.manifest.outputConstraint = { type: "digest", digest: c.digest("output", b.evidence.output) }; update(b);
    assert.equal(verify(b).ok, true);
    b.evidence.output = { arbitrary: "canonicalizable" }; reseal(b);
    assert.equal(verify(b).ok, false);
    assert.equal(verify(b).outputValidation.status, "FAIL");
  });
  it("H-2 explicitly reports unconstrained output as NOT_CHECKED, never meaningful verified output", function () {
    const b = bundle(); b.manifest.outputConstraint = { type: "unconstrained" }; update(b);
    b.evidence.output = "arbitrary"; reseal(b);
    const result = verify(b);
    assert.equal(result.ok, true);
    assert.equal(result.outputValidation.status, "NOT_CHECKED");
    assert.match(result.outputValidation.detail, /output correctness is not verified/);
  });
  it("H-2 binds the output constraint: stripping it or downgrading it cannot pass", function () {
    const b = bundle();
    b.manifest.outputConstraint = { type: "unconstrained" };
    assert.equal(verify(b).ok, false);
    delete b.manifest.outputConstraint;
    assert.equal(verify(b).ok, false);
  });
  it("H-2 isolates predicate mutations and does not run adapters on invalid bindings", function () {
    const b = bundle(); let calls = 0;
    const adapters = new Map([["synthetic-review@1", data => { calls++; data.specification.parameters.threshold = 0.99; return true; }]]);
    assert.equal(verify(b, { adapters }).ok, true);
    assert.equal(b.manifest.specification.parameters.threshold, 0.72);
    b.evidence.commitment = "0".repeat(64); reseal(b);
    assert.equal(verify(b, { adapters }).ok, false);
    assert.equal(calls, 1);
  });
  it("M-2 rejects impossible ordering and calendar times, but accepts equal asserted timestamps", function () {
    const b = bundle();
    b.evidence.completedAt = "2026-09-14T23:59:59.999Z"; reseal(b);
    assert.equal(verify(b).ok, false);
    b.evidence.completedAt = b.manifest.createdAt; reseal(b);
    assert.equal(verify(b).ok, true);
    b.evidence.completedAt = "2026-02-30T00:00:00.000Z";
    assert.equal(verify(b).ok, false);
    assert.match(verify(b).limitations, /trusted wall-clock time/);
  });
  it("M-3 independently generated blinding nonces change commitment without changing specification", function () {
    const b = bundle(), original = JSON.stringify(b.manifest.specification);
    const firstNonce = b.manifest.blindingNonce;
    assert.match(firstNonce, /^[0-9a-f]{64}$/);
    b.manifest.blindingNonce = c.newBlindingNonce();
    assert.notEqual(firstNonce, b.manifest.blindingNonce);
    assert.notEqual(c.unsafe.commit(b.manifest), b.expectedCommitment);
    assert.equal(JSON.stringify(b.manifest.specification), original);
    assert.equal(verify(b).ok, false);
    delete b.manifest.blindingNonce;
    assert.throws(() => c.unsafe.commit(b.manifest));
  });
  it("rejects suffix whitespace on nonce and context identifiers", function () {
    const b = bundle();
    b.manifest.blindingNonce += "\n";
    assert.throws(() => c.unsafe.commit(b.manifest));
    b.manifest.blindingNonce = c.newBlindingNonce();
    b.manifest.executionId += "\n";
    assert.throws(() => c.unsafe.commit(b.manifest));
  });
  it("M-2 coherent backdating remains possible and is not trusted chronology", function () {
    const b = bundle(); b.manifest.createdAt = "2000-01-01T00:00:00.000Z"; update(b);
    b.evidence.completedAt = b.manifest.createdAt; reseal(b);
    assert.equal(verify(b).ok, true);
    assert.match(verify(b).limitations, /trusted wall-clock time/);
  });
  it("M-5 primary API accepts UTF-8 bytes and text, never parsed objects", function () {
    const b = bundle();
    assert.equal(verify(b).ok, true);
    assert.equal(verify(b, { manifestWire: Buffer.from(c.canonicalize(b.manifest)) }).ok, true);
    assert.equal(c.verify(b).ok, false);
    assert.equal(c.verify(null).ok, false);
    assert.equal(verify(b, { manifestWire: b.manifest }).ok, false);
  });
  it("M-5 primary API rejects ambiguous/malformed wire, not just the parser helper", function () {
    const b = bundle(), manifest = c.canonicalize(b.manifest);
    const variants = [manifest.replace('"threshold":0.72', '"threshold":0.71,"threshold":0.72'),
      manifest.replace('"threshold":0.72', '"threshold":0.72,"thresh\\u006fld":0.72'),
      manifest.replace('0.72', '0.72000000000000001'), ' ' + manifest, manifest + '{}', '{oops',
      Buffer.from([0xff]), Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), Buffer.from(manifest)])];
    for (const manifestWire of variants) assert.equal(verify(b, { manifestWire }).ok, false);
    assert.equal(verify(b, { evidenceWire: '{"secret-identifier":oops}' }).ok, false);
    assert.ok(!JSON.stringify(verify(b, { evidenceWire: '{"secret-identifier":oops}' })).includes('secret-identifier'));
  });
  it("L-1 redacts sensitive keys by default, with explicit verbose diagnostics", function () {
    const b = bundle();
    b.evidence.observedSpecification["patient-123/private~name"] = { "ssn-123-45-6789": "private-value" }; reseal(b);
    const safe = JSON.stringify(verify(b));
    for (const secret of ["patient-123", "ssn-123", "private-value"]) assert.ok(!safe.includes(secret));
    assert.match(safe, /redacted/);
    assert.ok(JSON.stringify(verify(b, { verbose: true })).includes("patient-123~1private~0name"));
  });
  it("L-3 identical values hash differently in every artifact role and unknown domains fail", function () {
    assert.equal(new Set(c.DOMAINS.map(role => c.digest(role, { same: "bytes" }))).size, c.DOMAINS.length);
    assert.throws(() => c.digest("artifact", {}));
    assert.throws(() => c.digest("model\ninputs", {}));
  });
  it("L-4 enforces byte/member/node/depth budgets for every in-memory verification call", function () {
    const b = bundle();
    const tooWide = Object.fromEntries(Array.from({length:c.MAX_MEMBERS+1},(_,i)=>[i,0]));
    const tooManyNodes = Array.from({length:6},()=>Array.from({length:4000},()=>null));
    const tooDeep = Array.from({length:c.MAX_DEPTH+1}).reduce(v=>[v],0);
    const shared = Array.from({length:400},()=>"x".repeat(3000));
    const customArray = []; Object.setPrototypeOf(customArray, { map() { throw Error("must not run"); } });
    assert.throws(() => c.canonicalize(customArray), /non-plain/);
    for (const value of ["x".repeat(c.MAX_BYTES+1), tooWide, tooManyNodes, tooDeep, shared]) {
      assert.throws(() => c.canonicalize(value));
      const result = c.unsafe.verifyObjects({...b,evidence:{...b.evidence,output:value}});
      assert.equal(result.ok, false);
    }
    assert.equal(c.canonicalize("x".repeat(c.MAX_BYTES-2)).length, c.MAX_BYTES);
    assert.throws(() => c.canonicalize("\u0000".repeat(Math.ceil(c.MAX_BYTES/6))), /size/);
    assert.throws(() => c.canonicalize("😀".repeat(c.MAX_BYTES/4)), /size/);
    assert.throws(() => c.canonicalize(Array(c.MAX_MEMBERS+1).fill(0)), /member/);
  });
  it("L-4 aborts oversize string before calling JSON.stringify on it", function () {
    const original = JSON.stringify, value = "x".repeat(c.MAX_BYTES+1);
    let serialized = false;
    JSON.stringify = function(v,...args) { if (v === value) serialized = true; return original.call(JSON,v,...args); };
    try { assert.throws(() => c.canonicalize(value), /size/); } finally { JSON.stringify = original; }
    assert.equal(serialized, false);
  });
  it("L-4 caps diagnostic growth", function () {
    const b = bundle();
    for (let i=0;i<200;i++) b.evidence.observedSpecification['secret-'+i] = i;
    reseal(b);
    assert.equal(verify(b).mismatches.length, c.MAX_MISMATCHES);
  });
  it("M-1 repeated evidence and newly fabricated matching contexts remain possible, with no freshness claim", function () {
    const b = bundle();
    assert.equal(verify(b).ok, true); assert.equal(verify(b).ok, true);
    b.manifest.executionId = "new-operator-id"; update(b);
    b.expectedExecutionId = b.manifest.executionId;
    assert.equal(verify(b).ok, true);
    assert.match(verify(b).limitations, /freshness/);
  });
});

describe("cross-implementation canonicalization vectors", function () {
  for (const vector of vectors.accepted) it(vector.name, function () {
    const value = JSON.parse(vector.inputJson);
    assert.equal(c.canonicalize(value), vector.canonical);
    assert.equal(Buffer.from(vector.canonical).toString("hex"), vector.utf8Hex);
    assert.deepEqual(c.parseCanonical(vector.canonical), value);
    for (const role of c.DOMAINS) assert.equal(c.digest(role,value), vector.digests[role]);
  });
  for (const vector of vectors.rejected) it(`rejects ${vector.name}`, function () {
    assert.throws(() => c.parseCanonical(vector.wire));
  });
  for (const hex of vectors.rejectedUtf8Hex) it(`rejects invalid UTF-8 ${hex}`, function () {
    assert.throws(() => c.parseCanonical(Buffer.from(hex,"hex")));
  });
});

describe("separate retention CLI", function () {
  const cli = path.join(__dirname,"../scripts/verifiable-conformity.js");
  let dir;
  beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),"conformity-hardening-"));});
  afterEach(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:"utf8"});
  it("L-2 separates preparation, reviewer retention, execution and verification", function () {
    const operator=path.join(dir,"operator"),trusted=path.join(dir,"reviewer");
    fs.mkdirSync(trusted);
    assert.equal(run("prepare-demo",operator).status,0);
    const manifest=path.join(operator,"manifest.json"),anchor=path.join(trusted,"anchor.json");
    assert.equal(run("retain",manifest,anchor).status,0);
    const hash=c.parseCanonical(fs.readFileSync(anchor)).expectedCommitment;
    const evidence=path.join(operator,"evidence.json");
    assert.equal(run("execute-demo",manifest,hash,evidence).status,0);
    assert.equal(run("verify-demo",manifest,evidence,anchor).status,0);
    assert.equal(run("retain",manifest,anchor).status,1); // independent expected pin cannot be overwritten
    assert.equal(fs.existsSync(path.join(operator,"anchor.json")),false);
  });
  it("L-2 rejects aliased demo directories", function () {
    const same=path.join(dir,"same");
    assert.equal(run("demo",same,same).status,1);
    fs.symlinkSync(dir,path.join(dir,"alias"));
    assert.equal(run("demo",same,path.join(dir,"alias","same")).status,1);
  });
  it("L-4 bounds CLI files", function () {
    const file=path.join(dir,"large.json");
    fs.writeFileSync(file,"x".repeat(c.MAX_BYTES+2));
    assert.equal(run("commit",file).status,1);
  });
});

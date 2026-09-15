const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const core = require("../server/verifiableConformity");
const w = require("../examples/reconciliation-demo/workflow");
const { build } = require("../scripts/reconciliation-demo");
describe("synthetic management-review reconciliation", function () {
  let dir, candidate, trusted;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "reconciliation-demo-")); candidate = path.join(dir, "candidate"); trusted = path.join(dir, "reviewer"); w.createPackage(candidate); w.retain(candidate, trusted); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  function edit(file, mutate) { const full = path.join(candidate, file); const value = core.parseCanonical(w.read(full)); mutate(value); fs.writeFileSync(full, w.json(value)); }
  it("original package matches and reconciles to zero with the simulated approval bound to six files", function () {
    const r = w.check(candidate, trusted);
    assert.equal(r.report.ok, true); assert.equal(r.report.outputValidation.status, "PASS");
    assert.deepEqual(r.calculation, { adjustedStatementCents: 12350000, ledgerCents: 12350000, differenceCents: 0, withinTolerance: true });
    assert.equal(r.simulatedApprovalMatchesPackage, true);
    assert.equal(fs.existsSync(path.join(candidate, "anchor.json")), false);
  });
  it("changed support fails even if old calculation remains zero", function () {
    edit("reconciling-items.json", x => { x.outstandingPaymentsCents = 500000; });
    const r = w.check(candidate, trusted);
    assert.equal(r.report.ok, false); assert.equal(r.calculation.differenceCents, 50000);
    assert.equal(r.statedCalculation.differenceCents, 0); assert.equal(r.simulatedApprovalMatchesPackage, false);
    assert.ok(r.changedFiles.includes("Reconciling items"));
  });
  it("a balanced revision still fails against the previously retained package", function () {
    edit("reconciling-items.json", x => { x.depositsInTransitCents = 450000; x.outstandingPaymentsCents = 600000; });
    const r = w.check(candidate, trusted);
    assert.equal(r.calculation.differenceCents, 0); assert.equal(r.report.ok, false);
    assert.equal(r.simulatedApprovalMatchesPackage, false);
  });
  for (const [file, mutation] of [
    ["statement.json", x => { x.endingBalanceCents++; }], ["ledger.json", x => { x.endingBalanceCents++; }],
    ["assumptions.json", x => { x.differenceToleranceCents = 50000; }],
    ["calculation.json", x => { x.differenceCents = 100; }],
    ["approval.json", x => { x.reviewedPackageHash = "0".repeat(64); }],
  ]) it(`flags edits to ${file}`, function () { edit(file, mutation); assert.equal(w.check(candidate, trusted).report.ok, false); });
  it("flags edited review notes", function () { fs.appendFileSync(path.join(candidate, "review-notes.txt"), "Changed note."); assert.equal(w.check(candidate, trusted).report.ok, false); });
  it("rejects missing/extra package files and malformed or noncanonical data", function () {
    const file = path.join(candidate, "statement.json"), original = fs.readFileSync(file);
    for (const bad of ['{"secret":oops}', '{"periodEnd":"2026-06-30","endingBalanceCents":12500000,"endingBalanceCents":12500000}']) {
      fs.writeFileSync(file, bad); const result = w.check(candidate, trusted); assert.equal(result.report.ok, false); assert.ok(!JSON.stringify(result).includes("secret"));
    }
    fs.unlinkSync(file); assert.equal(w.check(candidate, trusted).report.ok, false);
    fs.writeFileSync(file, original); fs.writeFileSync(path.join(candidate, "extra.txt"), "extra"); assert.equal(w.check(candidate, trusted).report.ok, false);
  });
  it("rejects fractional or unsafe cents and unsupported calculation rules", function () {
    for (const n of [-1, 0.5, Number.MAX_SAFE_INTEGER]) {
      const inputs = w.observe(candidate).inputs; inputs.items.depositsInTransitCents = n;
      assert.throws(() => w.calculate(inputs));
    }
    const inputs = w.observe(candidate).inputs; inputs.assumptions.rule = "ignore differences"; assert.throws(() => w.calculate(inputs));
  });
  it("changing a retained manifest without its independently retained pin fails", function () {
    const file = path.join(trusted, "manifest.json"), m = core.parseCanonical(w.read(file));
    m.specification.fileHashes["approval.json"] = "0".repeat(64); fs.writeFileSync(file, w.json(m));
    assert.equal(w.check(candidate, trusted).report.ok, false);
  });
  it("rejects a mathematically wrong calculation even when its package and simulated approval are resealed", function () {
    edit("calculation.json", x => { x.differenceCents = 50000; });
    const hashes = Object.fromEntries(w.FILES.filter(f => f !== "approval.json").map(f => [f, require("../server/sha256").sha256(w.read(path.join(candidate, f)))]));
    edit("approval.json", x => { x.reviewedPackageHash = core.digest("inputs", hashes); });
    assert.throws(() => w.retain(candidate, path.join(dir, "another-reviewer")), /inconsistent/);
  });
  for (const target of ["candidate", "anchor"]) it(`rejects a ${target} FIFO without blocking`, function () {
    if (process.platform === "win32") this.skip(); // POSIX named pipes only.
    const file = target === "candidate" ? path.join(candidate, "statement.json") : path.join(trusted, "anchor.json");
    fs.unlinkSync(file);
    assert.equal(spawnSync("mkfifo", [file]).status, 0);
    const result = spawnSync(process.execPath, [path.join(__dirname, "../scripts/reconciliation-demo.js"), "check", candidate, trusted], { encoding: "utf8", timeout: 1500 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).report.status, "FAIL");
  });
  it("a newly retained, correctly calculated nonzero package passes only against its new reference", function () {
    edit("ledger.json", x => { x.endingBalanceCents -= 1500000; });
    const calculated = w.calculate(w.observe(candidate).inputs);
    fs.writeFileSync(path.join(candidate, "calculation.json"), w.json(calculated));
    const hashes = Object.fromEntries(w.FILES.filter(f => f !== "approval.json").map(f => [f, require("../server/sha256").sha256(w.read(path.join(candidate, f)))]));
    edit("approval.json", x => { x.reviewedPackageHash = core.digest("inputs", hashes); });
    assert.equal(w.check(candidate, trusted).report.ok, false);
    const replacement = path.join(dir, "replacement-reference");
    w.retain(candidate, replacement);
    const result = w.check(candidate, replacement);
    assert.equal(result.report.ok, true);
    assert.equal(result.calculation.differenceCents, 1500000);
    assert.equal(result.calculation.withinTolerance, false);
  });
  it("builds three cases and runs the standalone checker with correct exit codes", function () {
    const out = path.join(dir, "demo"), cli = path.join(__dirname, "../scripts/reconciliation-demo.js");
    build(out); assert.throws(() => build(out));
    for (const name of ["original", "changed-support", "changed-but-balanced"]) {
      const r = spawnSync(process.execPath, [cli, "check", path.join(out, "operator-packages", name), path.join(out, "reviewer-retained")], { encoding: "utf8" });
      assert.equal(r.status, name === "original" ? 0 : 1);
    }
  });
});

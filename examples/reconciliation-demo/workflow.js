// Synthetic package comparison only. No real institution, approval or execution attestation.
const fs = require("node:fs");
const path = require("node:path");
const { sha256 } = require("../../server/sha256");
const core = require("../../server/verifiableConformity");
const FILES = Object.freeze(["statement.json", "ledger.json", "reconciling-items.json", "assumptions.json", "review-notes.txt", "calculation.json", "approval.json"]);
const LABELS = Object.freeze({
  "statement.json": "Statement balance", "ledger.json": "Ledger balance",
  "reconciling-items.json": "Reconciling items", "assumptions.json": "Calculation assumptions",
  "review-notes.txt": "Review notes", "calculation.json": "Calculation", "approval.json": "Simulated approval",
});
const RULE = "statement + deposits in transit - outstanding payments; compare with ledger";
const PERIOD = "2026-06-30";
const STAMP = "2026-07-01T10:00:00.000Z"; // fictional asserted time, not a trusted timestamp
const json = value => core.canonicalize(value) + "\n";
function writeJSON(file, value) { fs.writeFileSync(file, json(value), { flag: "wx", mode: 0o600 }); }
function read(file) {
  // Nonblocking open lets the regular-file check reject FIFOs without hanging.
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error("expected regular file");
    const bytes = Buffer.alloc(core.MAX_BYTES + 2);
    let length = 0, n;
    while (length < bytes.length && (n = fs.readSync(fd, bytes, length, bytes.length - length, null)) > 0) length += n;
    if (length > core.MAX_BYTES + 1) throw new Error("package file too large");
    return bytes.subarray(0, length);
  } finally { fs.closeSync(fd); }
}
function shape(value, keys) {
  if (!value || Array.isArray(value) || typeof value !== "object" || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) throw new Error("invalid synthetic schema");
}
function amount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1e12) throw new Error("invalid synthetic cents amount");
}
function calculate({ statement, ledger, items, assumptions }) {
  for (const v of [statement, ledger]) { shape(v, ["periodEnd", "endingBalanceCents"]); amount(v.endingBalanceCents); }
  shape(items, ["periodEnd", "depositsInTransitCents", "outstandingPaymentsCents"]);
  shape(assumptions, ["currency", "differenceToleranceCents", "rule"]);
  if (statement.periodEnd !== PERIOD || ledger.periodEnd !== PERIOD || items.periodEnd !== PERIOD || assumptions.currency !== "USD" || assumptions.rule !== RULE) throw new Error("unsupported synthetic period or rule");
  for (const n of [items.depositsInTransitCents, items.outstandingPaymentsCents, assumptions.differenceToleranceCents]) amount(n);
  const adjustedStatementCents = statement.endingBalanceCents + items.depositsInTransitCents - items.outstandingPaymentsCents;
  const differenceCents = adjustedStatementCents - ledger.endingBalanceCents;
  return { adjustedStatementCents, ledgerCents: ledger.endingBalanceCents, differenceCents,
    withinTolerance: Math.abs(differenceCents) <= assumptions.differenceToleranceCents };
}
function fingerprint(hashes) {
  return core.digest("inputs", Object.fromEntries(FILES.filter(f => f !== "approval.json").map(f => [f, hashes[f]])));
}
function observe(directory) {
  const entries = fs.readdirSync(directory).sort();
  if (JSON.stringify(entries) !== JSON.stringify([...FILES].sort())) throw new Error("missing or unexpected package file");
  const bytes = Object.fromEntries(FILES.map(f => [f, read(path.join(directory, f))]));
  const fileHashes = Object.fromEntries(FILES.map(f => [f, sha256(bytes[f])]));
  const parse = f => core.parseCanonical(bytes[f]);
  const inputs = { statement: parse("statement.json"), ledger: parse("ledger.json"), items: parse("reconciling-items.json"), assumptions: parse("assumptions.json") };
  const expectedOutput = calculate(inputs);
  const output = parse("calculation.json"), approval = parse("approval.json");
  shape(approval, ["kind", "reviewerRole", "decision", "assertedAt", "reviewedPackageHash"]);
  const reviewedPackageHash = fingerprint(fileHashes);
  const approvalMatches = approval.kind === "simulated-approval" && approval.decision === "simulated-approved" &&
    approval.reviewerRole === "Fictional finance reviewer" && approval.assertedAt === STAMP && approval.reviewedPackageHash === reviewedPackageHash;
  return { inputs, output, expectedOutput, approvalMatches,
    specification: { workflow: { id: "synthetic-cash-reconciliation", version: "1" }, periodEnd: PERIOD, fileHashes, reviewedPackageHash } };
}
function createPackage(directory) {
  fs.mkdirSync(directory, { mode: 0o700 });
  const inputs = {
    statement: { periodEnd: PERIOD, endingBalanceCents: 12500000 },
    ledger: { periodEnd: PERIOD, endingBalanceCents: 12350000 },
    items: { periodEnd: PERIOD, depositsInTransitCents: 400000, outstandingPaymentsCents: 550000 },
    assumptions: { currency: "USD", differenceToleranceCents: 0, rule: RULE },
  };
  for (const [file, value] of [["statement.json", inputs.statement], ["ledger.json", inputs.ledger], ["reconciling-items.json", inputs.items], ["assumptions.json", inputs.assumptions], ["calculation.json", calculate(inputs)]]) writeJSON(path.join(directory, file), value);
  fs.writeFileSync(path.join(directory, "review-notes.txt"), "SYNTHETIC REVIEW NOTE - no actual review or approval occurred.\nFictional reviewer checked the stated balances, timing items and zero unexplained difference.\nThe simulated approval refers to the exact files in this package.\n", { flag: "wx", mode: 0o600 });
  const hashes = Object.fromEntries(FILES.filter(f => f !== "approval.json").map(f => [f, sha256(read(path.join(directory, f)))]));
  writeJSON(path.join(directory, "approval.json"), { kind: "simulated-approval", reviewerRole: "Fictional finance reviewer", decision: "simulated-approved", assertedAt: STAMP, reviewedPackageHash: fingerprint(hashes) });
}
function retain(directory, trustedDirectory) {
  const original = observe(directory);
  if (!original.approvalMatches || core.canonicalize(original.output) !== core.canonicalize(original.expectedOutput)) throw new Error("original package is inconsistent");
  fs.mkdirSync(trustedDirectory, { mode: 0o700 });
  const manifest = { protocol: core.PROTOCOL, executionId: "synthetic-close-2026-q2", blindingNonce: core.newBlindingNonce(), createdAt: STAMP,
    specification: original.specification, outputConstraint: { type: "adapter", id: "synthetic-cash-reconciliation", version: "1" } };
  const commitment = core.commitWire(json(manifest));
  writeJSON(path.join(trustedDirectory, "manifest.json"), manifest);
  writeJSON(path.join(trustedDirectory, "anchor.json"), { protocol: "verifiable-conformity/retained-anchor-v1", expectedCommitment: commitment, expectedExecutionId: manifest.executionId });
}
function check(directory, trustedDirectory) {
  try {
    const manifestWire = read(path.join(trustedDirectory, "manifest.json"));
    const manifest = core.parseCanonical(manifestWire), anchor = core.parseCanonical(read(path.join(trustedDirectory, "anchor.json")));
    shape(anchor, ["protocol", "expectedCommitment", "expectedExecutionId"]);
    if (anchor.protocol !== "verifiable-conformity/retained-anchor-v1") throw new Error("invalid anchor");
    const observed = observe(directory);
    // Evidence is created by observing the candidate files NOW, not asserted to be
    // a historical runtime receipt. The retained package is the comparison reference.
    const evidence = core.createEvidence({ commitment: anchor.expectedCommitment, executionId: anchor.expectedExecutionId,
      observedSpecification: observed.specification, output: observed.output, completedAt: new Date().toISOString() });
    const adapters = new Map([["synthetic-cash-reconciliation@1", ({ specification, output }) => observed.approvalMatches &&
      core.canonicalize(specification) === core.canonicalize(observed.specification) && core.canonicalize(output) === core.canonicalize(observed.expectedOutput)]]);
    const report = core.verify({ manifestWire, evidenceWire: json(evidence), expectedCommitment: anchor.expectedCommitment,
      expectedExecutionId: anchor.expectedExecutionId, adapters });
    // Domain-known labels only. Never echo arbitrary filenames or raw diagnostic keys.
    const changedFiles = FILES.filter(f => manifest.specification.fileHashes[f] !== observed.specification.fileHashes[f]).map(f => LABELS[f]);
    return { report, evidence, calculation: observed.expectedOutput, statedCalculation: observed.output,
      simulatedApprovalMatchesPackage: observed.approvalMatches, changedFiles };
  } catch {
    return { report: { ok: false, status: "FAIL", claim: "Candidate package could not be checked.", mismatches: [{ path: "/package", reason: "missing, unexpected or invalid package/anchor data" }] }, changedFiles: [] };
  }
}
module.exports = { FILES, LABELS, RULE, PERIOD, STAMP, json, writeJSON, read, calculate, observe, createPackage, retain, check };

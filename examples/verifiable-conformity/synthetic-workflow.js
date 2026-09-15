// Synthetic transaction review: deterministic toy scoring, no institution or real data.
const fs = require("node:fs");
const { sha256 } = require("../../server/sha256");
const { PROTOCOL, digest, createEvidence, newBlindingNonce, canonicalize } = require("../../server/verifiableConformity");
const MODEL = { id: "synthetic-risk-score", version: "1", multiplier: 1 };
const INPUT = [{ id: "synthetic-001", signal: 0.73 }, { id: "synthetic-002", signal: 0.2 }];
const POLICY = { id: "synthetic-review", version: "1", comparison: "score >= threshold", action: "review" };
const APPROVAL = { id: "synthetic-approval", version: "1", statement: "Fictional fixture only; no real authorization" };

function actualSpecification(threshold) {
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("threshold must be between 0 and 1");
  return {
    workflow: { id: "synthetic-transaction-review", version: "1" },
    model: { id: MODEL.id, version: MODEL.version, hash: digest("model", MODEL) },
    code: { algorithm: "sha256", hash: sha256(fs.readFileSync(__filename, "utf8")) },
    inputs: { hash: digest("inputs", INPUT) },
    parameters: { threshold },
    policy: { id: POLICY.id, version: POLICY.version, hash: digest("policy", POLICY) },
    approval: { id: APPROVAL.id, version: APPROVAL.version, hash: digest("approval", APPROVAL) },
  };
}
function makeManifest(executionId, createdAt = new Date().toISOString()) {
  return { protocol: PROTOCOL, executionId, blindingNonce: newBlindingNonce(), createdAt,
    specification: actualSpecification(0.72), outputConstraint: { type: "adapter", id: "synthetic-review", version: "1" } };
}
function compute(threshold) {
  actualSpecification(threshold); // validate the effective value, including when replayed
  return INPUT.map(row => {
    const score = row.signal * MODEL.multiplier;
    return { id: row.id, score, decision: score >= threshold ? POLICY.action : "clear" };
  });
}
function execute(manifest, commitment, threshold = manifest.specification.parameters.threshold) {
  // Observation is built from artifacts and the effective parameter actually used,
  // not by copying manifest claims about model, inputs, policy, approvals or code.
  const observedSpecification = actualSpecification(threshold);
  const output = compute(threshold);
  return createEvidence({ commitment, executionId: manifest.executionId, observedSpecification, output, completedAt: new Date().toISOString() });
}
// Verifier-controlled adapter: validates the exact local schema/artifacts and replay output.
const adapters = new Map([["synthetic-review@1", ({ specification, output }) => {
  const threshold = specification.parameters.threshold;
  return canonicalize(specification) === canonicalize(actualSpecification(threshold)) &&
    canonicalize(output) === canonicalize(compute(threshold));
}]]);
module.exports = { makeManifest, actualSpecification, compute, execute, adapters };

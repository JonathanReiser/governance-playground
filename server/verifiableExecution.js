/** Domain-neutral, offline evidence-conformity protocol. See examples/verifiable-execution/README.md. */
const { sha256 } = require("./sha256");
const PROTOCOL = "verifiable-execution/v0";
const MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 64;
const own = (o, k) => Object.hasOwn(o, k);
const plain = (o) => o !== null && typeof o === "object" &&
  (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);

// Deliberately versioned separately from legacy preregistration serialization.
// Emit keys directly: building a sorted JS object would re-order integer-like keys.
function canonicalize(value) {
  const active = new Set();
  function visit(v, depth) {
    if (depth > MAX_DEPTH) throw new Error("maximum JSON depth exceeded");
    if (v === null || typeof v === "boolean") return JSON.stringify(v);
    if (typeof v === "string") {
      if (!v.isWellFormed()) throw new Error("unpaired Unicode surrogate");
      return JSON.stringify(v);
    }
    if (typeof v === "number") {
      if (!Number.isFinite(v) || Object.is(v, -0) || (Number.isInteger(v) && !Number.isSafeInteger(v))) {
        throw new Error("unsupported JSON number");
      }
      return JSON.stringify(v);
    }
    if (!Array.isArray(v) && !plain(v)) throw new Error("only plain JSON values are supported");
    if (active.has(v)) throw new Error("cyclic JSON value");
    active.add(v);
    const keys = Reflect.ownKeys(v);
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (typeof key !== "string" || !own(d, "value") || (!d.enumerable && !(Array.isArray(v) && key === "length"))) {
        throw new Error("symbols, accessors and hidden properties are unsupported");
      }
    }
    let text;
    if (Array.isArray(v)) {
      if (keys.length !== v.length + 1) throw new Error("sparse arrays or array properties are unsupported");
      const items = [];
      for (let i = 0; i < v.length; i++) {
        if (!own(v, String(i))) throw new Error("sparse arrays are unsupported");
        items.push(visit(v[i], depth + 1));
      }
      text = `[${items.join(",")}]`;
    } else {
      text = `{${keys.sort().map(k => `${visit(k, depth + 1)}:${visit(v[k], depth + 1)}`).join(",")}}`;
    }
    active.delete(v);
    if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error("maximum JSON size exceeded");
    return text;
  }
  const text = visit(value, 0);
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error("maximum JSON size exceeded");
  return text;
}

// Canonical transport only (optional final LF). This rejects duplicate object keys,
// ambiguous numeric lexemes/rounding and invalid encodings rather than losing them in JSON.parse.
function parseCanonical(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_BYTES + 1) throw new Error("invalid JSON size");
  const wire = text.endsWith("\n") ? text.slice(0, -1) : text;
  const value = JSON.parse(wire);
  if (canonicalize(value) !== wire) throw new Error("expected canonical JSON (duplicate keys and noncanonical encodings are forbidden)");
  return value;
}
function digest(domain, value) {
  return sha256(`${PROTOCOL}\n${domain}\n${canonicalize(value)}`);
}
function exactKeys(o, keys, path) {
  if (!plain(o) || Object.keys(o).length !== keys.length || keys.some(k => !own(o, k))) throw new Error(`${path}: unexpected or missing fields`);
}
function identifier(v, path) {
  if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v)) throw new Error(`${path}: invalid identifier`);
}
function timestamp(v, path) {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) ||
      !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) throw new Error(`${path}: invalid UTC timestamp`);
}
function hash(v, path) {
  if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) throw new Error(`${path}: full lowercase SHA-256 required`);
}
function specification(v, path) {
  if (!plain(v) || Object.keys(v).length === 0) throw new Error(`${path}: nonempty object required`);
}
function validateManifest(manifest) {
  canonicalize(manifest);
  exactKeys(manifest, ["protocol", "executionId", "createdAt", "specification"], "manifest");
  if (manifest.protocol !== PROTOCOL) throw new Error("manifest.protocol: unsupported protocol");
  identifier(manifest.executionId, "manifest.executionId");
  timestamp(manifest.createdAt, "manifest.createdAt");
  specification(manifest.specification, "manifest.specification");
}
function commit(manifest) {
  validateManifest(manifest);
  return digest("manifest", manifest);
}
function createEvidence({ commitment, executionId, observedSpecification, output, completedAt }) {
  const body = { protocol: PROTOCOL, commitment, executionId, observedSpecification, output, completedAt };
  validateEvidenceBody(body);
  return { ...body, evidenceHash: digest("evidence", body) };
}
function validateEvidenceBody(body) {
  canonicalize(body);
  exactKeys(body, ["protocol", "commitment", "executionId", "observedSpecification", "output", "completedAt"], "evidence");
  if (body.protocol !== PROTOCOL) throw new Error("evidence.protocol: unsupported protocol");
  hash(body.commitment, "evidence.commitment");
  identifier(body.executionId, "evidence.executionId");
  timestamp(body.completedAt, "evidence.completedAt");
  specification(body.observedSpecification, "evidence.observedSpecification");
}
const pointer = (key) => String(key).replace(/~/g, "~0").replace(/\//g, "~1");
function differences(expected, actual, path = "/specification", out = []) {
  if (canonicalize(expected) === canonicalize(actual)) return out;
  const sameContainers = (plain(expected) && plain(actual)) || (Array.isArray(expected) && Array.isArray(actual));
  if (sameContainers) {
    if (Array.isArray(expected) && expected.length !== actual.length) out.push({ path: `${path}/length`, reason: "array length differs" });
    for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
      const child = `${path}/${pointer(key)}`;
      if (!own(expected, key)) out.push({ path: child, reason: "unexpected field" });
      else if (!own(actual, key)) out.push({ path: child, reason: "missing field" });
      else differences(expected[key], actual[key], child, out);
    }
  } else out.push({ path, reason: "value differs" });
  return out;
}

// expectedCommitment and expectedExecutionId are verifier-side trust inputs,
// NEVER defaults taken from the presented bundle. No storage/ledger/network dependency.
function verify(options = {}) {
  const mismatches = [];
  try {
    const { manifest, evidence, expectedCommitment, expectedExecutionId } = options;
    hash(expectedCommitment, "expectedCommitment");
    identifier(expectedExecutionId, "expectedExecutionId");
    validateManifest(manifest);
    canonicalize(evidence);
    exactKeys(evidence, ["protocol", "commitment", "executionId", "observedSpecification", "output", "completedAt", "evidenceHash"], "evidence");
    const { evidenceHash, ...body } = evidence;
    validateEvidenceBody(body);
    hash(evidenceHash, "evidence.evidenceHash");
    const check = (ok, path, reason) => { if (!ok) mismatches.push({ path, reason }); };
    check(commit(manifest) === expectedCommitment, "/manifest", "does not match independently retained commitment");
    check(evidence.commitment === expectedCommitment, "/evidence/commitment", "wrong commitment");
    check(manifest.executionId === expectedExecutionId, "/manifest/executionId", "wrong execution context");
    check(evidence.executionId === expectedExecutionId, "/evidence/executionId", "wrong execution context");
    check(evidenceHash === digest("evidence", body), "/evidence/evidenceHash", "evidence digest differs (not authentication)");
    differences(manifest.specification, evidence.observedSpecification, "/specification", mismatches);
  } catch (error) {
    mismatches.push({ path: "/", reason: `invalid input: ${error.message}` });
  }
  const ok = mismatches.length === 0;
  return {
    ok, status: ok ? "PASS" : "FAIL", mismatches,
    claim: ok ? "Presented evidence conforms to the manifest bound to the expected commitment and execution context." : "Presented evidence did not pass commitment/conformity checks.",
    limitations: "Self-reported evidence; no proof of actual execution, truthful inputs, approval authenticity, uniqueness, or pre-execution timing. Digests are not signatures. Timestamps are operator assertions.",
  };
}
module.exports = { PROTOCOL, MAX_BYTES, canonicalize, parseCanonical, digest, commit, createEvidence, differences, verify };

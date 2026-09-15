/** Offline conformity, not historical execution attestation. Primary API: verify(wire inputs). */
const { randomBytes, createHmac } = require("node:crypto");
const { TextDecoder } = require("node:util");
const { sha256 } = require("./sha256");
const PROTOCOL = "verifiable-conformity/v1";
const MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 20000;
const MAX_MEMBERS = 4096;
const MAX_MISMATCHES = 100;
const DOMAINS = Object.freeze(["model", "inputs", "policy", "approval", "output", "manifest", "evidence"]);
const own = (o, k) => Object.hasOwn(o, k);
const plain = (o) => o !== null && typeof o === "object" &&
  (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);

// Trusted in-memory data only (not executable proxies). Preflight before encoding:
// bound structure, aggregate UTF-8/escape bytes and scalar length before JSON.stringify.
function canonicalize(value) {
  let bytes = 0, nodes = 0;
  const active = new Set();
  function add(n) { bytes += n; if (bytes > MAX_BYTES) throw new Error("maximum JSON size exceeded"); }
  function stringSize(s) {
    if (s.length > MAX_BYTES) throw new Error("maximum JSON size exceeded");
    if (!s.isWellFormed()) throw new Error("unpaired Unicode surrogate");
    add(2);
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      add(cp === 34 || cp === 92 || [8, 9, 10, 12, 13].includes(cp) ? 2 :
        cp < 32 ? 6 : cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4);
    }
  }
  function preflight(v, depth) {
    if (++nodes > MAX_NODES) throw new Error("maximum JSON node count exceeded");
    if (depth > MAX_DEPTH) throw new Error("maximum JSON depth exceeded");
    if (v === null || typeof v === "boolean") { add(v === false ? 5 : 4); return; }
    if (typeof v === "string") { stringSize(v); return; }
    if (typeof v === "number") {
      if (!Number.isFinite(v) || Object.is(v, -0) || (Number.isInteger(v) && !Number.isSafeInteger(v))) throw new Error("unsupported JSON number");
      add(JSON.stringify(v).length); return;
    }
    if (!Array.isArray(v) && !plain(v)) throw new Error("only plain JSON values are supported");
    if (active.has(v)) throw new Error("cyclic JSON value");
    active.add(v);
    if (Array.isArray(v) && Object.getPrototypeOf(v) !== Array.prototype) throw new Error("non-plain arrays are unsupported");
    if (Array.isArray(v) && v.length > MAX_MEMBERS) throw new Error("maximum JSON member count exceeded");
    // Reflect.ownKeys necessarily enumerates an existing JS object. This is not a
    // sandbox for hostile proxies; prefer the bounded wire API at trust boundaries.
    const keys = Reflect.ownKeys(v);
    if (keys.length > MAX_MEMBERS + (Array.isArray(v) ? 1 : 0)) throw new Error("maximum JSON member count exceeded");
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (typeof key !== "string" || !own(d, "value") || (!d.enumerable && !(Array.isArray(v) && key === "length"))) throw new Error("symbols, accessors and hidden properties are unsupported");
    }
    add(2);
    if (Array.isArray(v)) {
      if (keys.length !== v.length + 1) throw new Error("sparse arrays or array properties are unsupported");
      for (let i = 0; i < v.length; i++) {
        if (!own(v, String(i))) throw new Error("sparse arrays are unsupported");
        if (i) add(1);
        preflight(v[i], depth + 1);
      }
    } else {
      keys.forEach((k, i) => { if (i) add(1); stringSize(k); add(1); preflight(v[k], depth + 1); });
    }
    active.delete(v);
  }
  preflight(value, 0);
  // Emit keys directly; a JS object would re-order integer-like keys numerically.
  function encode(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(encode).join(",")}]`;
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${encode(v[k])}`).join(",")}}`;
  }
  return encode(value);
}
function parseCanonical(input) {
  let text;
  if (typeof input === "string") {
    if (input.length > MAX_BYTES + 1 || Buffer.byteLength(input, "utf8") > MAX_BYTES + 1) throw new Error("invalid JSON size");
    text = input;
  } else if (input instanceof Uint8Array) {
    if (input.byteLength > MAX_BYTES + 1) throw new Error("invalid JSON size");
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
  } else throw new Error("canonical UTF-8 bytes or text required");
  const wire = text.endsWith("\n") ? text.slice(0, -1) : text;
  const value = JSON.parse(wire);
  if (canonicalize(value) !== wire) throw new Error("expected canonical JSON");
  return value;
}
function digest(domain, value) {
  if (!DOMAINS.includes(domain)) throw new Error("unsupported digest domain");
  return sha256(`${PROTOCOL}\n${domain}\n${canonicalize(value)}`);
}
const newBlindingNonce = () => randomBytes(32).toString("hex");
function exactKeys(o, keys, path) {
  if (!plain(o) || Object.keys(o).length !== keys.length || keys.some(k => !own(o, k))) throw new Error(`${path}: unexpected or missing fields`);
}
function identifier(v, path) {
  if (typeof v !== "string" || v.length < 1 || v.length > 128 || !/^[A-Za-z0-9]/.test(v) || /[^A-Za-z0-9._:-]/.test(v)) throw new Error(`${path}: invalid identifier`);
}
function timestamp(v, path) {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) ||
      !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) throw new Error(`${path}: invalid UTC timestamp`);
}
function hash(v, path) {
  if (typeof v !== "string" || v.length !== 64 || !/^[a-f0-9]{64}$/.test(v)) throw new Error(`${path}: full lowercase SHA-256 required`);
}
function specification(v, path) {
  if (!plain(v) || Object.keys(v).length === 0) throw new Error(`${path}: nonempty object required`);
}
function validateManifest(manifest) {
  canonicalize(manifest);
  exactKeys(manifest, ["protocol", "executionId", "blindingNonce", "createdAt", "specification", "outputConstraint"], "manifest");
  if (manifest.protocol !== PROTOCOL) throw new Error("manifest.protocol: unsupported protocol");
  identifier(manifest.executionId, "manifest.executionId");
  hash(manifest.blindingNonce, "manifest.blindingNonce"); // shape only; entropy cannot be proven
  timestamp(manifest.createdAt, "manifest.createdAt");
  specification(manifest.specification, "manifest.specification");
  const c = manifest.outputConstraint;
  if (c?.type === "unconstrained") exactKeys(c, ["type"], "outputConstraint");
  else if (c?.type === "digest") { exactKeys(c, ["type", "digest"], "outputConstraint"); hash(c.digest, "outputConstraint.digest"); }
  else if (c?.type === "adapter") {
    exactKeys(c, ["type", "id", "version"], "outputConstraint");
    identifier(c.id, "outputConstraint.id"); identifier(c.version, "outputConstraint.version");
  } else throw new Error("outputConstraint: unsupported constraint");
}
function commit(manifest) { validateManifest(manifest); return digest("manifest", manifest); }
function commitWire(wire) { return commit(parseCanonical(wire)); }
function createEvidence({ commitment, executionId, observedSpecification, output, completedAt }) {
  const body = { protocol: PROTOCOL, commitment, executionId, observedSpecification, output, completedAt };
  validateEvidenceBody(body);
  return { ...body, evidenceHash: digest("evidence", body) };
}
function validateEvidenceBody(body) {
  canonicalize(body);
  exactKeys(body, ["protocol", "commitment", "executionId", "observedSpecification", "output", "completedAt"], "evidence");
  if (body.protocol !== PROTOCOL) throw new Error("evidence.protocol: unsupported protocol");
  hash(body.commitment, "evidence.commitment"); identifier(body.executionId, "evidence.executionId");
  timestamp(body.completedAt, "evidence.completedAt"); specification(body.observedSpecification, "evidence.observedSpecification");
}
const pointer = key => String(key).replace(/~/g, "~0").replace(/\//g, "~1");
function differences(expected, actual, path = "/specification", verbose = false, diagnosticKey = randomBytes(32)) {
  canonicalize(expected); canonicalize(actual);
  if (!Buffer.isBuffer(diagnosticKey) || diagnosticKey.length !== 32) throw new Error("diagnosticKey must be a private 32-byte Buffer");
  // A reviewer-controlled secret, never the manifest's nonce or a public digest.
  // Fresh by default; reusing a private key explicitly enables cross-report correlation.
  const key = Buffer.from(diagnosticKey);
  const out = [];
  function add(p, shown, reason) {
    const fieldId = createHmac("sha256", key).update("conformity-diagnostic-path/v1\n" + p, "utf8").digest("hex");
    out.push({ path: shown, fieldId, reason });
  }
  function walk(a, b, p, shown) {
    if (out.length >= MAX_MISMATCHES || Object.is(a, b)) return;
    if ((plain(a) && plain(b)) || (Array.isArray(a) && Array.isArray(b))) {
      for (const part of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        if (out.length >= MAX_MISMATCHES) break;
        const child = `${p}/${pointer(part)}`;
        const display = `${shown}/${verbose === true ? pointer(part) : "[redacted]"}`;
        if (!own(a, part)) add(child, display, "unexpected field");
        else if (!own(b, part)) add(child, display, "missing field");
        else walk(a[part], b[part], child, display);
      }
    } else add(p, shown, "value differs");
  }
  walk(expected, actual, path, path);
  return out;
}
const LIMITATIONS = "No proof of historical execution or actual execution, non-fabrication, truthful inputs, correct model/policy, genuine approval, absence of alternative runs, trusted wall-clock time, freshness or regulatory compliance. Digests are not authentication. Timestamps are operator assertions.";
function result(mismatches, outputValidation) {
  const ok = mismatches.length === 0;
  return { ok, status: ok ? "PASS" : "FAIL", scope: "presented-evidence conformity", mismatches,
    diagnostics: "At most 100 specification mismatches; object-key segments redacted unless verbose is explicitly enabled; fieldId distinguishes paths (report-local unless a private diagnosticKey is reused).",
    outputValidation,
    claim: ok ? "Given an independently retained commitment and expected context, presented manifest/evidence conforms to the committed specification." + (outputValidation.status === "NOT_CHECKED" ? " Output correctness is not verified: no output constraint was declared." : "") : "Presented manifest/evidence did not pass conformity checks.",
    limitations: LIMITATIONS };
}
// INTERNAL/UNSAFE FOR UNTRUSTED WIRE: cannot recover duplicate keys or rounding
// already lost by a caller's parser. Trusted local synchronous adapters only.
function verifyObjects(options = {}) {
  const mismatches = [];
  let outputValidation = { status: "NOT_RUN", detail: "Output correctness is not verified." };
  try {
    const { manifest, evidence, expectedCommitment, expectedExecutionId, adapters = new Map(), verbose = false, diagnosticKey } = options;
    hash(expectedCommitment, "expectedCommitment"); identifier(expectedExecutionId, "expectedExecutionId");
    validateManifest(manifest); canonicalize(evidence);
    exactKeys(evidence, ["protocol", "commitment", "executionId", "observedSpecification", "output", "completedAt", "evidenceHash"], "evidence");
    const { evidenceHash, ...body } = evidence;
    validateEvidenceBody(body); hash(evidenceHash, "evidence.evidenceHash");
    const check = (ok, path, reason) => { if (!ok) mismatches.push({ path, reason }); };
    check(commit(manifest) === expectedCommitment, "/manifest", "does not match independently retained commitment");
    check(evidence.commitment === expectedCommitment, "/evidence/commitment", "wrong commitment");
    check(manifest.executionId === expectedExecutionId, "/manifest/executionId", "wrong expected context (not a freshness check)");
    check(evidence.executionId === expectedExecutionId, "/evidence/executionId", "wrong expected context (not a freshness check)");
    check(Date.parse(evidence.completedAt) >= Date.parse(manifest.createdAt), "/evidence/completedAt", "precedes manifest.createdAt (internal chronology only)");
    check(evidenceHash === digest("evidence", body), "/evidence/evidenceHash", "evidence digest differs (not authentication)");
    mismatches.push(...differences(manifest.specification, evidence.observedSpecification, "/specification", verbose === true, diagnosticKey));
    if (!mismatches.length) {
      const c = manifest.outputConstraint;
      if (c.type === "unconstrained") outputValidation = { status: "NOT_CHECKED", detail: "No output constraint: output correctness is not verified." };
      else {
        let accepted = false;
        if (c.type === "digest") accepted = digest("output", evidence.output) === c.digest;
        else {
          const predicate = adapters instanceof Map && adapters.get(`${c.id}@${c.version}`);
          if (typeof predicate !== "function") throw new Error("required trusted output adapter unavailable");
          // Isolate adapter mutations from inputs already checked. Predicate/schema
          // wrappers must return literal true; exceptions, promises/truthy values fail.
          const copy = parseCanonical(canonicalize({ specification: manifest.specification, output: evidence.output }));
          try {
            const answer = predicate(copy);
            if (answer instanceof Promise) answer.catch(() => {}); // no unhandled rejection from unsupported async adapters
            accepted = answer === true;
          } catch { accepted = false; }
        }
        outputValidation = { status: accepted ? "PASS" : "FAIL", method: c.type, detail: "Only the committed output constraint is checked; this does not authenticate output or prove historical correctness." };
        check(accepted, "/output", "committed output constraint failed");
      }
    }
  } catch {
    // Never echo parser/adapter exception text; it may contain secret values/keys.
    mismatches.push({ path: "/", reason: "invalid input or required output adapter unavailable" });
  }
  return result(mismatches, outputValidation);
}
// Primary trust-boundary API: canonical bytes/text, independently retained hash/context.
function verify(options = {}) {
  try {
    const { manifestWire, evidenceWire, ...trustedOptions } = options;
    return verifyObjects({ ...trustedOptions, manifest: parseCanonical(manifestWire), evidence: parseCanonical(evidenceWire) });
  } catch { return result([{ path: "/", reason: "invalid canonical wire input" }], { status: "NOT_RUN", detail: "Output correctness is not verified." }); }
}
module.exports = { PROTOCOL, MAX_BYTES, MAX_DEPTH, MAX_NODES, MAX_MEMBERS, MAX_MISMATCHES, DOMAINS,
  canonicalize, parseCanonical, digest, newBlindingNonce, commitWire, createEvidence, verify,
  unsafe: { commit, verifyObjects, differences } };

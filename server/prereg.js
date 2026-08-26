/**
 * prereg.js — pre-registration for simulation runs.
 *
 * WHAT PROBLEM THIS SOLVES. `WorldRegistry.commitCycle` writes five integers
 * per cycle to chain. That is tamper-evidence for what was *published*, not
 * integrity of what was *computed*: metrics are calculated off-chain and then
 * written, so nothing in the contract stops anyone running the simulation fifty
 * times and committing only the run they liked. The README calls this out; this
 * module is the answer it promised and did not yet implement.
 *
 * WHAT IT IS NOT. The sibling project civic-lottery-demo closes this gap
 * completely, because everything after its seed is deterministic and any
 * verifier can re-run the draw and get the same winners. That is not available
 * here and never will be: an LLM is in the loop, so the same config and the
 * same entropy will not regenerate the same run. Cryptographic reproducibility
 * is off the table permanently, not pending work.
 *
 * WHAT IT DOES INSTEAD — the clinical-trial-registry mechanism. Publish the
 * parameters first: scenario, cycle count, agent model, the doctrine half of
 * every prompt, the decision schemas. Bind them to a NIST beacon pulse that
 * DOES NOT EXIST YET, identified only by a future timestamp. Then run once at
 * or after that time and publish whatever comes back.
 *
 * The future-pulse binding is the load-bearing part. At registration time
 * nobody — including the operator — can know what the beacon will say, so
 * nobody can know which parameters would turn out favourable. It does not make
 * cherry-picking impossible. It makes NON-PUBLICATION VISIBLE: a registration
 * with no matching result is itself a public fact, and that is the whole
 * mechanism. A promised result that never appears is evidence.
 *
 * Structure and canonical-JSON discipline follow civic-lottery-demo's
 * ledger.js / canonicalJson.js, adapted from ESM to this project's CommonJS.
 */

const crypto = require("crypto");

const BEACON_BASE = "https://beacon.nist.gov/beacon/2.0/pulse";

// ─────────────────────────────────────────────────────────────
// Canonical serialization
//
// Plain JSON.stringify is not safe for hashing: two verifiers can build the
// same data with keys in different insertion order and get different bytes,
// so honest re-verification would fail for a serialization quirk rather than
// for real tampering. Sort recursively so the same data always hashes the same.
// ─────────────────────────────────────────────────────────────

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, k) => {
      acc[k] = sortKeysDeep(value[k]);
      return acc;
    }, {});
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function hashRecord(record) {
  return sha256(canonicalStringify(record));
}

// ─────────────────────────────────────────────────────────────
// NIST beacon
// ─────────────────────────────────────────────────────────────

/**
 * The pulse at or after `timeMs`. NIST emits one pulse per 60s, so a
 * registration's drawAfter time resolves to exactly one pulse, and any
 * verifier asking the same question later gets the same answer.
 *
 * No PRNG fallback here, deliberately — unlike the lottery's entropy path,
 * where a labeled fallback beats failing a draw. A pre-registration whose
 * entropy came from Math.random would be theatre: the operator would control
 * the value they promised not to control. If NIST is unreachable, the correct
 * outcome is that the run does not happen yet.
 */
async function fetchBeaconAtOrAfter(timeMs, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const uri = `${BEACON_BASE}/time/next/${timeMs}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(uri, { signal: controller.signal });
    if (!res.ok) throw new Error(`NIST beacon HTTP ${res.status} for ${uri}`);
    const pulse = (await res.json())?.pulse;
    if (!pulse || typeof pulse.outputValue !== "string") {
      throw new Error("NIST beacon returned an unexpected response shape");
    }
    return {
      pulseIndex: pulse.pulseIndex,
      timeStamp: pulse.timeStamp,
      outputValue: pulse.outputValue,
      uri,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────
// Phase 1 — REGISTER (before any entropy exists)
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {string} o.scenarioId
 * @param {number} o.cycles              how many cycles will be run
 * @param {string} o.mode                e.g. "ai-quantum-tier1"
 * @param {string} o.agentModel          exact model id, e.g. "claude-opus-5"
 * @param {string} [o.agentEffort]       output_config.effort the run will use
 * @param {Record<string,string>} o.doctrine   nation -> doctrine half of its prompt
 * @param {Record<string,object>} o.schemas    nation -> decision schema
 * @param {number} o.drawAfterMs         epoch ms; must be in the future
 */
function createRegistration({ scenarioId, cycles, mode, agentModel, agentEffort, doctrine, schemas, drawAfterMs, now = Date.now() }) {
  if (!Number.isFinite(drawAfterMs) || drawAfterMs <= now) {
    throw new Error("drawAfterMs must be in the future — the point is to bind to entropy that does not exist yet");
  }
  const record = {
    kind: "governance-playground/preregistration",
    version: 1,
    createdAt: new Date(now).toISOString(),
    scenarioId,
    cycles,
    mode,
    agentModel,
    // The same model at a different effort is a different instrument, so it is
    // part of what a registration promises, not an implementation detail.
    agentEffort: agentEffort ?? null,
    // Hash the prompts rather than inline them: the full text lives in the repo
    // at the committed revision, and a hash is what a verifier actually needs.
    doctrineHashes: Object.fromEntries(
      Object.entries(doctrine).sort().map(([n, text]) => [n, sha256(text)]),
    ),
    schemaHashes: Object.fromEntries(
      Object.entries(schemas).sort().map(([n, s]) => [n, hashRecord(s)]),
    ),
    drawAfter: new Date(drawAfterMs).toISOString(),
    beaconUri: `${BEACON_BASE}/time/next/${drawAfterMs}`,
    commitment:
      "One run will be executed at or after drawAfter, seeded from the NIST pulse at beaconUri, " +
      "and its full per-cycle output published whatever it says.",
  };
  return { record, hash: hashRecord(record) };
}

// ─────────────────────────────────────────────────────────────
// Phase 2 — SEAL (after the run)
// ─────────────────────────────────────────────────────────────

function sealRun({ registrationHash, beacon, cycles, servedModels, now = Date.now() }) {
  const record = {
    kind: "governance-playground/run-result",
    version: 1,
    registrationHash,
    beacon,
    completedAt: new Date(now).toISOString(),
    // Which model actually produced each decision. Normally the registered
    // one; a refusal fallback would show up here as a different id, and a run
    // that silently swapped models is exactly what this is here to expose.
    servedModels: [...new Set(servedModels)].sort(),
    cycles,
  };
  // Chain the result to both the promise and the entropy, in that order.
  const chain = sha256(registrationHash + beacon.outputValue + canonicalStringify(cycles));
  return { record: { ...record, chain }, hash: hashRecord({ ...record, chain }) };
}

// ─────────────────────────────────────────────────────────────
// Phase 3 — VERIFY
// ─────────────────────────────────────────────────────────────

/**
 * Re-derives everything a third party can check without trusting the operator.
 * Set `liveBeaconCheck` to re-fetch the pulse from NIST rather than trusting
 * the copy embedded in the result.
 */
async function verifyRun({ registration, result, liveBeaconCheck = true, fetchImpl = fetch }) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  const regHash = hashRecord(registration);
  add("registration hash recomputes", regHash === result.registrationHash,
    `${regHash.slice(0, 16)}… vs ${String(result.registrationHash).slice(0, 16)}…`);

  const drawAfter = Date.parse(registration.drawAfter);
  const pulseTime = Date.parse(result.beacon.timeStamp);
  add("pulse is at or after the registered time", pulseTime >= drawAfter,
    `pulse ${result.beacon.timeStamp} vs drawAfter ${registration.drawAfter}`);

  const { chain, ...unchained } = result;
  const expectedChain = sha256(result.registrationHash + result.beacon.outputValue + canonicalStringify(result.cycles));
  add("result chains to registration and entropy", expectedChain === chain,
    `${expectedChain.slice(0, 16)}… vs ${String(chain).slice(0, 16)}…`);
  void unchained;

  add("run used the registered model only",
    result.servedModels.length === 1 && result.servedModels[0] === registration.agentModel,
    `served: ${result.servedModels.join(", ")} | registered: ${registration.agentModel}`);

  if (liveBeaconCheck) {
    try {
      const live = await fetchBeaconAtOrAfter(drawAfter, { fetchImpl });
      add("NIST independently returns the same pulse", live.outputValue === result.beacon.outputValue,
        `pulse #${live.pulseIndex}`);
    } catch (err) {
      add("NIST independently returns the same pulse", false, `could not reach NIST: ${err.message}`);
    }
  }

  return {
    ok: checks.every((c) => c.ok),
    checks,
    // Say the limit out loud in the output itself, so nobody quotes a passing
    // verification as more than it is.
    proves:
      "Parameters were fixed before the entropy existed; the entropy is genuine and third-party; " +
      "the published result is bound to both.",
    doesNotProve:
      "That no other runs were executed. An LLM is in the loop, so the run is not reproducible from " +
      "the seed and cannot be independently re-derived. What this makes visible is non-publication: " +
      "a registration with no matching result is a public fact.",
  };
}

module.exports = {
  canonicalStringify, sha256, hashRecord,
  fetchBeaconAtOrAfter,
  createRegistration, sealRun, verifyRun,
  BEACON_BASE,
};

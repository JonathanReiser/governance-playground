/**
 * Preregistration for Quantum Policy Tic-Tac-Toe hardware validation.
 *
 * A sibling of server/prereg.js, not an extension of it. That module's schema is
 * shaped around scenarios, cycles and agent models; overloading it would put two
 * unrelated experiments in one namespace and one archive. The primitives —
 * canonical hashing and the NIST beacon binding — are reused; the record is not.
 *
 * WHAT THIS BINDS. Release 1 is implementation-only, so the hypothesis cannot be
 * about people, strategy or advantage. It is about the device: does the pinned
 * backend reproduce the distributions the protocol predicts? That is falsifiable,
 * fixable in advance, and answerable without a single human participant.
 */

const { canonicalStringify, sha256, hashRecord, fetchBeaconAtOrAfter, BEACON_BASE } = require("./prereg");

const REGISTRATION_KIND = "quantum-arena/hardware-validation-preregistration";
const RESULT_KIND = "quantum-arena/hardware-validation-result";

/**
 * @param {object} o
 * @param {Array<{operationX: string, operationO: string, gamma: number}>} o.cells
 * @param {number} o.shotsPerCell
 * @param {string} o.backend            pinned device name
 * @param {number} o.tvdThreshold       per-cell pass criterion
 * @param {object} o.thresholdBasis     how the threshold was derived, BEFORE any run
 * @param {number} o.drawAfterMs
 */
function createArenaRegistration({
  cells, shotsPerCell, backend, tvdThreshold, thresholdBasis, protocolVersion = "1.0", drawAfterMs, now = Date.now(),
}) {
  if (!Number.isFinite(drawAfterMs) || drawAfterMs <= now) {
    throw new Error("drawAfterMs must be in the future — the point is to bind to entropy that does not exist yet");
  }
  if (!Array.isArray(cells) || cells.length === 0) {
    throw new Error("at least one cell must be registered");
  }
  if (!Number.isInteger(shotsPerCell) || shotsPerCell < 1) {
    throw new Error("shotsPerCell must be a positive integer");
  }
  if (!(tvdThreshold > 0 && tvdThreshold < 1)) {
    throw new Error("tvdThreshold must lie strictly between 0 and 1");
  }
  if (!thresholdBasis || typeof thresholdBasis.method !== "string") {
    throw new Error("thresholdBasis must record how the threshold was derived before the run");
  }

  const record = {
    kind: REGISTRATION_KIND,
    version: 1,
    createdAt: new Date(now).toISOString(),
    protocolVersion,
    hypothesis:
      "For every registered cell, the total variation distance between the backend's " +
      "empirical distribution over [CC, CD, DC, DD] and the protocol's exact Born " +
      "distribution is at most tvdThreshold.",
    falsifiedIf:
      "Any single registered cell exceeds tvdThreshold. Not a majority, not an average — " +
      "an average over cells would let a clean cell pay for a broken one.",
    claimBoundary:
      "This tests whether the device reproduces the predicted distributions. It is NOT a " +
      "test of quantum advantage, of any equilibrium, or of human behaviour, and release 1 " +
      "claims none of those.",
    backend,
    backendSelection: "pinned; least_busy is not used, so every cell runs on the same device",
    cells: [...cells]
      .map((c) => ({ operationX: c.operationX, operationO: c.operationO, gamma: c.gamma }))
      .sort((a, b) => `${a.operationX}${a.operationO}${a.gamma}`.localeCompare(`${b.operationX}${b.operationO}${b.gamma}`)),
    shotsPerCell,
    statistic: "total variation distance, 0.5 * sum |empirical - exact| over the four profiles",
    tvdThreshold,
    thresholdBasis,
    readoutMitigation:
      "Raw counts only. Mitigated figures, if computed, are published as a separate record " +
      "and never substituted for these.",
    drawAfter: new Date(drawAfterMs).toISOString(),
    beaconUri: `${BEACON_BASE}/time/next/${drawAfterMs}`,
    commitment:
      "Every registered cell will be executed at or after drawAfter on the named backend, and " +
      "every cell's raw counts published whatever they say — not the cells that came out well. " +
      "If the backend is unavailable the run is abandoned and reported as abandoned; it is not " +
      "silently re-pointed at another device, and simulator output is never published here.",
  };
  return { record, hash: hashRecord(record) };
}

function sealArenaResult({ registrationHash, beacon, cells, backendReported, now = Date.now() }) {
  const record = {
    kind: RESULT_KIND,
    version: 1,
    registrationHash,
    beacon,
    completedAt: new Date(now).toISOString(),
    backendReported,
    cellCount: cells.length,
    cells,
  };
  const chain = sha256(registrationHash + beacon.outputValue + canonicalStringify(cells));
  return { record: { ...record, chain }, hash: hashRecord({ ...record, chain }) };
}

async function verifyArenaResult({ registration, result, liveBeaconCheck = true, fetchImpl = fetch }) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  add("registration hash recomputes", hashRecord(registration) === result.registrationHash,
    `${hashRecord(registration)} vs ${result.registrationHash}`);

  const pulseTime = Date.parse(result.beacon.timeStamp);
  add("beacon pulse is at or after drawAfter", pulseTime >= Date.parse(registration.drawAfter),
    `pulse ${result.beacon.timeStamp} vs drawAfter ${registration.drawAfter}`);

  const expectedChain = sha256(result.registrationHash + result.beacon.outputValue + canonicalStringify(result.cells));
  add("chain hash recomputes", expectedChain === result.chain, `${expectedChain} vs ${result.chain}`);

  add("every registered cell was published", result.cells.length === registration.cells.length,
    `${result.cells.length} published vs ${registration.cells.length} registered`);

  add("the backend that ran is the backend that was pinned",
    result.backendReported === registration.backend,
    `${result.backendReported} vs ${registration.backend}`);

  add("no cell was run on a simulator",
    result.cells.every((c) => c.simulator === false),
    "simulator output must never be published as a hardware result");

  add("shot counts match the registration",
    result.cells.every((c) => c.shots === registration.shotsPerCell),
    `expected ${registration.shotsPerCell} per cell`);

  if (liveBeaconCheck) {
    try {
      const live = await fetchBeaconAtOrAfter(Date.parse(registration.drawAfter), { fetchImpl });
      add("NIST independently returns the same pulse", live.outputValue === result.beacon.outputValue,
        `pulse #${live.pulseIndex}`);
    } catch (error) {
      add("NIST independently returns the same pulse", false, `beacon unreachable: ${error.message}`);
    }
  }

  const exceeded = result.cells.filter((c) => c.tvd > registration.tvdThreshold);
  return {
    checks,
    verified: checks.every((c) => c.ok),
    hypothesisUpheld: exceeded.length === 0,
    cellsExceedingThreshold: exceeded.map((c) => ({ ...c, threshold: registration.tvdThreshold })),
  };
}

module.exports = { REGISTRATION_KIND, RESULT_KIND, createArenaRegistration, sealArenaResult, verifyArenaResult };

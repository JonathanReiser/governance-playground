/**
 * Client for the Quantum Policy Tic-Tac-Toe arena.
 *
 * The browser only calls the server. Python/NumPy is the independent scientific
 * reference; server/quantumArena.js is its parity-tested serverless deployment
 * port, and Qiskit remains the optional hardware path.
 */

/**
 * Neutral participant labels, in the frozen menu order.
 *
 * The protocol forbids telling a participant that a setting is intelligent,
 * optimal or "more quantum". C/D/M/Q would do that outright, and so would
 * "cooperate"/"defect" — the theoretical names ARE the leak. Roman numerals
 * carry no ordering claim beyond position, and the mapping is recorded in the
 * run record rather than shown.
 */
export const NEUTRAL_LABELS = [
  { label: "Setting I", operation: "C" },
  { label: "Setting II", operation: "D" },
  { label: "Setting III", operation: "M" },
  { label: "Setting IV", operation: "Q" },
];

export const MAX_ENTANGLEMENT = Math.PI / 2;

export function labelFor(operation) {
  return NEUTRAL_LABELS.find((entry) => entry.operation === operation)?.label ?? "unknown";
}

/** Internal policy codes remain in records but never appear in participant UI. */
export function policyLabelFor(policy) {
  return policy === "C" ? "Policy I" : policy === "D" ? "Policy II" : "unknown policy";
}

export function profileLabelFor(profile) {
  if (typeof profile !== "string" || profile.length !== 2) return "unknown outcome";
  return `${policyLabelFor(profile[0])} / ${policyLabelFor(profile[1])}`;
}

/**
 * Draw the opponent's operation uniformly from the frozen menu.
 *
 * Release 1 makes no behavioural claim, so the opponent is deliberately not a
 * strategy — a uniform draw smuggles in no theory of play. The draw's entropy
 * source is recorded, following quantumRng.js's rule that a fallback never
 * wears the label it did not earn.
 */
export function drawOpponentOperation(cryptoApi = globalThis.crypto) {
  if (cryptoApi?.getRandomValues) {
    const draw = new Uint32Array(1);
    cryptoApi.getRandomValues(draw);
    return { operation: NEUTRAL_LABELS[draw[0] % NEUTRAL_LABELS.length].operation, source: "web-crypto" };
  }
  throw new Error("Secure randomisation is unavailable; the arena cannot draw an opponent.");
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({ error: `non-JSON response (${response.status})` }));
  if (!response.ok) throw new Error(payload.error || `request failed with ${response.status}`);
  return payload;
}

/** One research observation. A single shot selects the policy pair. */
export function playArena({ operationX, operationO, gamma }) {
  return post("/api/arena/play", { operationX, operationO, gamma });
}

/**
 * Many-shot outcome estimates for the explanation mode.
 * Returns a DIFFERENT schema; the protocol requires these never mix with plays.
 */
export function explainArena({ operationX, operationO, gamma, shots = 4096 }) {
  return post("/api/arena/explain", { operationX, operationO, gamma, shots });
}

const ARENA_KEY = "governance-playground:quantum-arena-plays:v1";

/**
 * Arena records live under their own key, separate from the Phase 0 decision
 * lab's. Validation item 10: arena records keep their own schema and archive,
 * and Phase 0 observations are never relabelled as quantum-game data. Sharing
 * a store is how that stops being true.
 */
export function readArenaPlays(storage = localStorage) {
  try {
    const value = JSON.parse(storage.getItem(ARENA_KEY) || "[]");
    return Array.isArray(value) ? value.filter((row) => row?.schema === "quantum-arena-play/v1") : [];
  } catch {
    return [];
  }
}

export function appendArenaPlay(record, storage = localStorage) {
  if (record?.schema !== "quantum-arena-play/v1") {
    return { ok: false, count: readArenaPlays(storage).length, error: "refusing to store a non-play record in the play archive" };
  }
  try {
    const rows = [...readArenaPlays(storage), record];
    storage.setItem(ARENA_KEY, JSON.stringify(rows));
    return { ok: true, count: rows.length, error: null };
  } catch (error) {
    return { ok: false, count: readArenaPlays(storage).length, error: error instanceof Error ? error.message : String(error) };
  }
}

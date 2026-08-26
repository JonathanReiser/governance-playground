/**
 * "My Runs" — a browser-local record of every no-wallet demo deploy this
 * browser has made, so reloading the page doesn't lose track of what you
 * just did. Deliberately not an account system: no login, no backend,
 * nothing that leaves this browser. See ViewRunPage.jsx for the other
 * half of this — a shareable permalink that reconstructs a run's real
 * results straight from Sepolia for anyone with the link, not just you.
 *
 * Every read/write is wrapped defensively: private browsing, a full
 * storage quota, or a browser with storage disabled can all make
 * localStorage throw. None of that should ever break the app — a run
 * just silently doesn't get remembered.
 */

const STORAGE_KEY = "governance-playground:runs";
const MAX_RUNS = 50;

/**
 * Builds the `?view=` query string for a run, including `&block=` when
 * the run has a registryBlock — see onchainLogs.js's header comment for
 * why ViewRunPage.jsx needs that to read event logs at all on a public
 * RPC. A run saved before this field existed simply omits it; ViewRunPage
 * falls back to a bounded recent-window search in that case.
 */
export function viewUrlFor(run) {
  const params = new URLSearchParams({ view: run.registryAddress });
  if (Number.isInteger(run.registryBlock)) params.set("block", String(run.registryBlock));
  return `?${params.toString()}`;
}

export function listRuns() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Records a deploy. Deduplicates by registryAddress (a retry or a
 * revisit shouldn't create a second entry) and keeps the list capped and
 * newest-first.
 */
export function saveRun(run) {
  try {
    const existing = listRuns().filter((r) => r.registryAddress !== run.registryAddress);
    const next = [{ ...run, savedAt: new Date().toISOString() }, ...existing].slice(0, MAX_RUNS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — the deploy itself already succeeded on-chain;
    // failing to remember it locally isn't worth surfacing as an error.
  }
}

export function removeRun(registryAddress) {
  try {
    const next = listRuns().filter((r) => r.registryAddress !== registryAddress);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // see saveRun
  }
}

export function clearRuns() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // see saveRun
  }
}

/**
 * "Continue this run" — lets a visitor resume running agent cycles on a
 * run saved earlier, from THIS browser, picking up the exact quantum/
 * market state a cycle left off at rather than starting a fresh quantum
 * trajectory. Deliberately separate from the `runs` list above: this is
 * the (larger, and only sometimes present) state a run needs to keep
 * going, not the lightweight summary "My Runs" displays for every run
 * whether or not it's resumable.
 *
 * Why this can only ever work in the browser that ran it: only the
 * classical, already-collapsed metrics and the reasoning text get
 * written on-chain (see WorldRegistry.sol's commitCycleWithNarrative) —
 * the quantum belief qubits and market instrument state that actually
 * drive each cycle's decisions are never persisted anywhere else. A run
 * opened via a shared `?view=` link, or on a different browser, or after
 * this browser's storage was cleared, genuinely has no way to recover
 * that state — there's no "Continue" to offer for it, not a missing
 * feature.
 *
 * Keyed by registryAddress (object map, not the `runs` array) for direct
 * lookup; capped and LRU-evicted the same way `saveRun` caps `runs`.
 */
const CONTINUATIONS_KEY = "governance-playground:continuations";
const MAX_CONTINUATIONS = 50;

function readContinuations() {
  try {
    const raw = window.localStorage.getItem(CONTINUATIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getContinuation(registryAddress) {
  return readContinuations()[registryAddress] || null;
}

export function saveContinuation(registryAddress, continuation) {
  try {
    const all = readContinuations();
    all[registryAddress] = { ...continuation, updatedAt: new Date().toISOString() };
    const entries = Object.entries(all);
    if (entries.length > MAX_CONTINUATIONS) {
      entries.sort((a, b) => new Date(b[1].updatedAt) - new Date(a[1].updatedAt));
      window.localStorage.setItem(CONTINUATIONS_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, MAX_CONTINUATIONS))));
    } else {
      window.localStorage.setItem(CONTINUATIONS_KEY, JSON.stringify(all));
    }
  } catch {
    // Storage unavailable, or this run's state happens to be too large
    // for whatever quota is left — the cycle itself already committed on
    // -chain either way; failing to remember how to resume it locally
    // isn't worth surfacing as an error (same reasoning as saveRun's).
  }
}

export function clearContinuation(registryAddress) {
  try {
    const all = readContinuations();
    delete all[registryAddress];
    window.localStorage.setItem(CONTINUATIONS_KEY, JSON.stringify(all));
  } catch {
    // see saveRun
  }
}

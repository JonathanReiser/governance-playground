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

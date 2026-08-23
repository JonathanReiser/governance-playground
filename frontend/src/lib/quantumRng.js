/**
 * quantumRng.js — Tier 1 of "real quantum indeterminacy": the entropy
 * source instinct.js's "ON GENUINE INDETERMINACY" note names as the seam
 * to fill. See that note before reading this file — the short version:
 * quantum-circuit computes exact Born-rule probabilities, but something
 * still has to sample against them, and Math.random() sampling a real
 * probability distribution is still a classical PRNG underneath.
 *
 * WHAT THIS DOES: sources that one sample from the ANU Quantum Random
 * Numbers Server (qrng.anu.edu.au) — a public API backed by a physical
 * experiment (laser vacuum-fluctuation measurements), not a relabeled
 * PRNG. Run live against the real endpoint while building this
 * (2026-08-23): `{"type":"uint16","length":1,"data":[62088],"success":true}`,
 * CORS-open (`Access-Control-Allow-Origin: *`), so this is safe to call
 * directly from the browser, no server-side proxy needed.
 *
 * WHAT THIS DOES NOT DO: make the circuit's entanglement (the CX gate in
 * instinct.js's buildInstinctCircuit) physically real. The RY/CX math is
 * still exact classical simulation; only the final sample against that
 * simulated distribution is now physically sourced. Getting the
 * entanglement itself onto real qubits means actually running the circuit
 * on IBM hardware (Tier 2) — see the sibling quantum-orch-or repo, which
 * already has a working QiskitRuntimeService connection this project could
 * borrow the pattern from. Don't let this module's existence imply Tier 2
 * is done; it isn't.
 *
 * FAILURE HANDLING: a public free API can rate-limit, time out, or go
 * down mid-demo. Every failure mode falls back to an injectable
 * `fallbackRng` (defaults to Math.random) — but the result always says so
 * honestly via `source`/`detail` rather than silently wearing the
 * "anu-qrng" label it didn't earn. Callers (readInstinct/
 * proposeVetoInstinct in instinct.js) thread that provenance into the
 * citable reading, the same way this project has always distinguished
 * "verified live" from "not yet tested."
 */

const ANU_QRNG_URL = "https://qrng.anu.edu.au/API/jsonI.php?length=1&type=uint16";
const UINT16_RANGE = 65536; // type=uint16 -> integers in [0, 65535]

/**
 * One real (or honestly-labeled fallback) random float in [0, 1).
 *
 * @param fetchImpl    injectable fetch — defaults to the global fetch.
 *                     Pass a fake in tests so the suite never makes a real
 *                     network call.
 * @param fallbackRng  injectable entropy source used on any failure path
 *                     — defaults to Math.random, matching the default
 *                     every other rng seam in this project already uses.
 * @param timeoutMs    abort the request if ANU hasn't responded by then,
 *                     rather than hanging a governance-cycle review on a
 *                     slow public API. Default 5s.
 * @returns {Promise<{value: number, source: "anu-qrng"|"math-random-fallback", detail?: string}>}
 */
export async function quantumRandomFloat({
  fetchImpl = typeof fetch === "function" ? fetch : undefined,
  fallbackRng = Math.random,
  timeoutMs = 5000,
} = {}) {
  const fallback = (detail) => ({ value: fallbackRng(), source: "math-random-fallback", detail });

  if (typeof fetchImpl !== "function") {
    return fallback("no fetch implementation available in this environment");
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchImpl(ANU_QRNG_URL, controller ? { signal: controller.signal } : undefined);
    if (!response.ok) {
      return fallback(`ANU QRNG HTTP ${response.status}`);
    }

    const body = await response.json();
    const raw = body?.data?.[0];
    if (body?.success !== true || typeof raw !== "number" || !Number.isFinite(raw)) {
      return fallback("ANU QRNG returned an unexpected response shape");
    }
    if (raw < 0 || raw > UINT16_RANGE - 1) {
      return fallback(`ANU QRNG value ${raw} out of the expected uint16 range`);
    }

    return { value: raw / UINT16_RANGE, source: "anu-qrng" };
  } catch (err) {
    const reason = err?.name === "AbortError" ? `ANU QRNG request timed out after ${timeoutMs}ms` : `ANU QRNG request failed: ${err.message}`;
    return fallback(reason);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

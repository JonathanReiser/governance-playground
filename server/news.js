/**
 * Real news grounding for the agent layer's headline context.
 *
 * Until now, "News headlines this cycle:" in every nation's prompt (see
 * SYSTEM_PROMPTS in server.js) was entirely self-narrating: template
 * strings selected by thresholds on the simulation's OWN fictional state
 * (generateHeadlinesMiddleEast/TaiwanStrait in server.js — e.g. "Iran
 * closes Hormuz Strait" fires when hormuzStatus === "CLOSED" in the sim).
 * Nothing about them was fetched from anywhere real. This module replaces
 * that with actual current articles about Iran/Israel or China/Taiwan.
 *
 * Source: GDELT's DOC 2.0 API (api.gdeltproject.org) — a free, keyless,
 * global news index. No API key means no new secret to provision, and no
 * new failure mode where the demo breaks because a key expired.
 *
 * Every other structured field a nation reasons over (dealIntegrity,
 * hormuzStatus, hardlinerPressure, ...) is passed to the prompt
 * separately and explicitly — the headlines block was always supplementary
 * texture, never the only source of truth. That's what makes this a safe
 * swap: real headlines won't describe the fictional scenario's specific
 * counterfactual state (there is no real "Hormuz-Nuclear Agreement"), and
 * they don't need to — they give the model genuine current geopolitical
 * grounding alongside the structured fictional state, the way a human
 * analyst reads real news without confusing it for the scenario they're
 * wargaming.
 *
 * Honest fallback: if GDELT is unreachable, times out, or returns nothing
 * usable, the caller (server.js's getHeadlines) falls back to the old
 * mock generator and labels the result "mock-fallback" — never silently
 * presented as real. Same labeling discipline as collapseSource/
 * qpu-real-hardware elsewhere in this project.
 */

const NEWS_QUERIES = {
  "middle-east-2026": "Iran Israel sourcelang:english",
  "taiwan-strait-2026": "China Taiwan sourcelang:english",
};

// Real news doesn't move fast enough to need fetching on every single
// nation's decide call (a cycle fires 3-4 of those in parallel, all
// wanting the same scenario's headlines) — cache per scenario for a few
// minutes so a cycle shares one GDELT round trip instead of making
// several identical ones.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // scenarioId -> { headlines: string[], fetchedAt: number }

function dedupeByTitle(articles) {
  // GDELT indexes syndicated wire copy separately per outlet — the same
  // AP/Reuters headline often comes back 3-4 times under different
  // domains. Dedupe on normalized title so the model doesn't see the same
  // headline repeated as if it were independent corroboration.
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    const key = (a.title || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/**
 * Fetches (or returns cached) real headlines for a scenario. Throws on any
 * failure — network error, non-200, empty results — rather than returning
 * something empty/misleading; the caller decides what "no real news"
 * means for its context (server.js falls back to the mock generator).
 *
 * `fetchImpl` and `now` are injectable so tests can simulate GDELT
 * success/failure/empty-results deterministically without a real network
 * call — same pattern frontend/src/lib/agents.js already uses for its own
 * external calls (proposeInstinctReadingsViaQPU's fetchImpl param).
 */
async function fetchRealHeadlines(scenarioId, { fetchImpl = fetch, now = Date.now, ttlMs = CACHE_TTL_MS } = {}) {
  const cached = cache.get(scenarioId);
  if (cached && now() - cached.fetchedAt < ttlMs) {
    return cached.headlines;
  }

  const query = NEWS_QUERIES[scenarioId];
  if (!query) throw new Error(`No news query configured for scenario: ${scenarioId}`);

  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=10&format=json&sort=hybridrel&timespan=3d`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`GDELT HTTP ${res.status}`);

  const data = await res.json();
  const articles = dedupeByTitle(data.articles || []);
  if (articles.length === 0) throw new Error("GDELT returned zero usable articles");

  const headlines = articles.slice(0, 4).map((a) => `${a.title.trim()} (${a.domain})`);
  cache.set(scenarioId, { headlines, fetchedAt: now() });
  return headlines;
}

function clearCache() {
  cache.clear();
}

module.exports = { fetchRealHeadlines, NEWS_QUERIES, CACHE_TTL_MS, clearCache };

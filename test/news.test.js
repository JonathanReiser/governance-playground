/**
 * Tests for server/news.js — the real (GDELT) news-grounding fetch, with
 * an injectable fetchImpl/now so these run deterministically with no real
 * network call, mirroring the pattern frontend/src/lib/agents.js already
 * uses for its own external calls (proposeInstinctReadingsViaQPU).
 */

const { expect } = require("chai");
const { fetchRealHeadlines, NEWS_QUERIES, clearCache } = require("../server/news");

function fakeGdeltResponse(articles) {
  return { ok: true, status: 200, json: async () => ({ articles }) };
}

function article(title, domain) {
  return { title, domain, url: `https://${domain}/x`, seendate: "20260826T000000Z", language: "English" };
}

describe("server/news.js — fetchRealHeadlines", function () {
  beforeEach(function () {
    clearCache();
  });

  it("has a query configured for both scenarios", function () {
    expect(NEWS_QUERIES["middle-east-2026"]).to.be.a("string").and.not.empty;
    expect(NEWS_QUERIES["taiwan-strait-2026"]).to.be.a("string").and.not.empty;
  });

  it("returns real article titles with their domain", async function () {
    const fetchImpl = async () => fakeGdeltResponse([
      article("Iran warns of harsh response to sanctions", "reuters.com"),
      article("Netanyahu says talks continue", "apnews.com"),
    ]);
    const headlines = await fetchRealHeadlines("middle-east-2026", { fetchImpl });
    expect(headlines).to.have.lengthOf(2);
    expect(headlines[0]).to.include("Iran warns of harsh response to sanctions").and.to.include("reuters.com");
  });

  it("dedupes syndicated copies of the same headline across domains", async function () {
    const fetchImpl = async () => fakeGdeltResponse([
      article("Netanyahu got his Iran war", "philstar.com"),
      article("Netanyahu got his Iran war", "moneycontrol.com"),
      article("  Netanyahu got his Iran war  ", "al-monitor.com"), // same after trim, different domain
      article("A distinct second story", "jpost.com"),
    ]);
    const headlines = await fetchRealHeadlines("middle-east-2026", { fetchImpl });
    expect(headlines).to.have.lengthOf(2);
  });

  it("caps at 4 headlines even when more come back", async function () {
    const fetchImpl = async () => fakeGdeltResponse(
      Array.from({ length: 10 }, (_, i) => article(`Story ${i}`, `outlet${i}.com`))
    );
    const headlines = await fetchRealHeadlines("taiwan-strait-2026", { fetchImpl });
    expect(headlines).to.have.lengthOf(4);
  });

  it("throws on a non-200 response", async function () {
    const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
    let threw = null;
    try {
      await fetchRealHeadlines("middle-east-2026", { fetchImpl });
    } catch (e) { threw = e; }
    expect(threw).to.not.equal(null);
    expect(threw.message).to.match(/GDELT HTTP 503/);
  });

  it("throws when GDELT returns zero articles", async function () {
    const fetchImpl = async () => fakeGdeltResponse([]);
    let threw = null;
    try {
      await fetchRealHeadlines("middle-east-2026", { fetchImpl });
    } catch (e) { threw = e; }
    expect(threw).to.not.equal(null);
    expect(threw.message).to.match(/zero usable articles/);
  });

  it("throws when the fetch itself rejects (network failure)", async function () {
    const fetchImpl = async () => { throw new TypeError("Failed to fetch"); };
    let threw = null;
    try {
      await fetchRealHeadlines("middle-east-2026", { fetchImpl });
    } catch (e) { threw = e; }
    expect(threw).to.not.equal(null);
    expect(threw.message).to.equal("Failed to fetch");
  });

  it("throws for a scenario with no configured query", async function () {
    let threw = null;
    try {
      await fetchRealHeadlines("not-a-real-scenario", { fetchImpl: async () => fakeGdeltResponse([]) });
    } catch (e) { threw = e; }
    expect(threw).to.not.equal(null);
    expect(threw.message).to.match(/No news query configured/);
  });

  it("caches within the TTL — a second call doesn't hit fetchImpl again", async function () {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return fakeGdeltResponse([article("Cached story", "reuters.com")]); };
    let now = 1_000_000;
    const opts = { fetchImpl, now: () => now, ttlMs: 60_000 };

    const first = await fetchRealHeadlines("middle-east-2026", opts);
    now += 30_000; // still inside the TTL
    const second = await fetchRealHeadlines("middle-east-2026", opts);

    expect(calls).to.equal(1);
    expect(second).to.deep.equal(first);
  });

  it("refetches once the TTL has elapsed", async function () {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return fakeGdeltResponse([article(`Story batch ${calls}`, "reuters.com")]);
    };
    let now = 1_000_000;
    const opts = { fetchImpl, now: () => now, ttlMs: 60_000 };

    await fetchRealHeadlines("middle-east-2026", opts);
    now += 61_000; // past the TTL
    await fetchRealHeadlines("middle-east-2026", opts);

    expect(calls).to.equal(2);
  });

  it("caches middle-east-2026 and taiwan-strait-2026 independently", async function () {
    const fetchImpl = async (url) => fakeGdeltResponse([
      article(url.includes("Taiwan") ? "Taiwan story" : "Iran story", "reuters.com"),
    ]);
    const me = await fetchRealHeadlines("middle-east-2026", { fetchImpl });
    const tw = await fetchRealHeadlines("taiwan-strait-2026", { fetchImpl });
    expect(me[0]).to.include("Iran story");
    expect(tw[0]).to.include("Taiwan story");
  });
});

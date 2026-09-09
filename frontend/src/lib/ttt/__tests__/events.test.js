import { describe, expect, it } from "vitest";
import {
  appendDecisionEvent, appendSessionResult, clearDecisionEvents, participantId,
  persistResearchSnapshot, readDecisionEvents, readSessionResults, readTrainingEvents, restoreResearchSnapshot,
  setActiveResearchSession,
} from "../events";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("decision persistence", () => {
  it("round-trips only recognized event schemas", () => {
    const storage = memoryStorage();
    expect(appendDecisionEvent({ schema: "ttt-decision/v1", selected_move: 4 }, storage).ok).toBe(true);
    expect(readDecisionEvents(storage)).toEqual([{ schema: "ttt-decision/v1", selected_move: 4 }]);
  });

  it("reports a write failure instead of throwing", () => {
    const storage = { getItem: () => "[]", setItem: () => { throw new Error("quota"); } };
    expect(appendDecisionEvent({ schema: "ttt-decision/v1" }, storage)).toEqual({ ok: false, count: 0, error: "quota" });
  });

  it("keeps a stable browser participant id", () => {
    const storage = memoryStorage();
    expect(participantId(storage)).toBe(participantId(storage));
  });

  it("persists completed sessions separately and clears both research stores", () => {
    const storage = memoryStorage();
    appendDecisionEvent({ schema: "ttt-decision/v1", selected_move: 4 }, storage);
    appendSessionResult({ schema: "ttt-session-result/v1", session_id: "s1" }, storage);
    expect(readSessionResults(storage)).toHaveLength(1);
    clearDecisionEvents(storage);
    expect(readDecisionEvents(storage)).toEqual([]);
    expect(readSessionResults(storage)).toEqual([]);
  });

  it("excludes the active session from model training", () => {
    const storage = memoryStorage();
    appendDecisionEvent({ schema: "ttt-decision/v1", session_id: "done" }, storage);
    appendDecisionEvent({ schema: "ttt-decision/v1", session_id: "active" }, storage);
    setActiveResearchSession("active", storage);
    expect(readTrainingEvents(storage).map((event) => event.session_id)).toEqual(["done"]);
  });

  it("sends a complete research snapshot to the durable local archive", async () => {
    const storage = memoryStorage();
    appendDecisionEvent({ schema: "ttt-decision/v1", session_id: "s1" }, storage);
    appendSessionResult({ schema: "ttt-session-result/v1", session_id: "s1" }, storage);
    const requests = [];
    const fetchImpl = async (url, options) => {
      requests.push({ url, options });
      const request = JSON.parse(options.body);
      return { ok: true, json: async () => ({
        ok: true, event_count: 1, session_count: 1, saved_at: "now", archive_id: "archive",
        writer_id: request.durable_request.writer_id, writer_sequence: request.durable_request.sequence,
      }) };
    };
    expect(await persistResearchSnapshot(fetchImpl, storage)).toMatchObject({ ok: true, eventCount: 1, sessionCount: 1 });
    expect(requests[0].url).toBe("/api/ttt/persist");
    expect(JSON.parse(requests[0].options.body)).toMatchObject({ schema: "ttt-research-export/v1" });
  });

  it("treats an ignored stale snapshot as a backup failure", async () => {
    const storage = memoryStorage();
    appendDecisionEvent({ schema: "ttt-decision/v1", session_id: "s1" }, storage);
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ ok: true, stale_write_ignored: true, event_count: 20 }),
    });
    await expect(persistResearchSnapshot(fetchImpl, storage)).resolves.toMatchObject({ ok: false, code: "stale_snapshot" });
  });

  it("declines to adopt an identity from an archive holding several participants", async () => {
    const storage = memoryStorage();
    const archive = {
      schema: "ttt-research-export/v1",
      events: [
        { schema: "ttt-decision/v1", participant_id: "alice", session_id: "a", game_id: "g", recorded_at: "t1", selected_move: 0 },
        { schema: "ttt-decision/v1", participant_id: "bob", session_id: "b", game_id: "g", recorded_at: "t2", selected_move: 1 },
      ],
      sessions: [],
    };
    const fetchImpl = async () => ({ ok: true, json: async () => archive });
    expect((await restoreResearchSnapshot(fetchImpl, storage)).ok).toBe(true);
    expect(storage.getItem("governance-playground:ttt-participant:v1")).toBeNull();
    expect(["alice", "bob"]).not.toContain(participantId(storage));
  });

  it("resumes a single archived participant on a fresh browser", async () => {
    const storage = memoryStorage();
    const archive = {
      schema: "ttt-research-export/v1",
      events: [
        { schema: "ttt-decision/v1", participant_id: "alice", session_id: "a", game_id: "g", recorded_at: "t1", selected_move: 0 },
        { schema: "ttt-decision/v1", participant_id: "alice", session_id: "a", game_id: "g", recorded_at: "t2", selected_move: 1 },
      ],
      sessions: [],
    };
    const fetchImpl = async () => ({ ok: true, json: async () => archive });
    expect((await restoreResearchSnapshot(fetchImpl, storage)).ok).toBe(true);
    expect(participantId(storage)).toBe("alice");
  });

  it("restores and merges a durable archive without duplicating current events", async () => {
    const storage = memoryStorage();
    const event = { schema: "ttt-decision/v1", session_id: "s1", game_id: "g1", recorded_at: "now", selected_move: 4, participant_id: "p1" };
    appendDecisionEvent(event, storage);
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        schema: "ttt-research-export/v1",
        events: [event, { ...event, game_id: "g2" }],
        sessions: [{ schema: "ttt-session-result/v1", session_id: "s1" }],
      }),
    });
    expect(await restoreResearchSnapshot(fetchImpl, storage)).toMatchObject({ ok: true, eventCount: 2, sessionCount: 1 });
    expect(readDecisionEvents(storage)).toHaveLength(2);
    expect(participantId(storage)).toBe("p1");
  });
});

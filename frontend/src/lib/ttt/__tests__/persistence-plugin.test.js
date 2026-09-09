import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeResearchArchive } from "../../../../tttPersistencePlugin";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function archive(eventCount) {
  return {
    schema: "ttt-research-export/v1",
    events: Array.from({ length: eventCount }, (_, index) => ({ schema: "ttt-decision/v1", event_id: `event-${index}`, selected_move: index })),
    sessions: [],
    durable_request: { writer_id: "browser-a", sequence: eventCount },
  };
}

describe("durable research archive", () => {
  it("hard-fails when an older write from the same browser arrives late", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ttt-persistence-"));
    temporaryDirectories.push(directory);
    await writeResearchArchive(archive(2), directory);
    await expect(writeResearchArchive(archive(1), directory)).rejects.toMatchObject({ code: "stale_snapshot" });
    const stored = JSON.parse(await readFile(path.join(directory, "ttt-research-latest.json"), "utf8"));
    expect(stored.events).toHaveLength(2);
    expect(stored.durable_copy.event_count).toBe(2);
  });

  it("merges new post-clear records into the preserved durable archive", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ttt-persistence-"));
    temporaryDirectories.push(directory);
    await writeResearchArchive(archive(2), directory);
    const afterClear = {
      schema: "ttt-research-export/v1",
      events: [{ schema: "ttt-decision/v1", event_id: "event-after-clear", selected_move: 4 }],
      sessions: [],
      durable_request: { writer_id: "browser-a", sequence: 3 },
    };
    const result = await writeResearchArchive(afterClear, directory);
    const stored = JSON.parse(await readFile(path.join(directory, "ttt-research-latest.json"), "utf8"));
    expect(result).toMatchObject({ event_count: 3, writer_id: "browser-a", writer_sequence: 3, merged: true });
    expect(stored.events.map((event) => event.event_id)).toEqual(["event-0", "event-1", "event-after-clear"]);
  });

  it("deduplicates a full snapshot while advancing its monotonic sequence", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ttt-persistence-"));
    temporaryDirectories.push(directory);
    await writeResearchArchive(archive(2), directory);
    const next = archive(2);
    next.durable_request.sequence = 3;
    const result = await writeResearchArchive(next, directory);
    const stored = JSON.parse(await readFile(path.join(directory, "ttt-research-latest.json"), "utf8"));
    expect(result.event_count).toBe(2);
    expect(stored.events).toHaveLength(2);
  });
});

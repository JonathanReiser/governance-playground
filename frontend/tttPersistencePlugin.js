import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const DEFAULT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "research-data");

function readRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_ARCHIVE_BYTES) {
        reject(new Error("Research archive exceeds the 16 MB local limit."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function validateArchive(payload) {
  if (payload?.schema !== "ttt-research-export/v1" || !Array.isArray(payload.events) || !Array.isArray(payload.sessions)) {
    throw new Error("Invalid Tic-Tac-Toe research archive.");
  }
  if (!payload.events.every((event) => event?.schema === "ttt-decision/v1")) {
    throw new Error("Archive contains an unrecognized decision event.");
  }
  if (!payload.sessions.every((session) => session?.schema === "ttt-session-result/v1")) {
    throw new Error("Archive contains an unrecognized session result.");
  }
  if (
    typeof payload.durable_request?.writer_id !== "string"
    || !payload.durable_request.writer_id
    || !Number.isSafeInteger(payload.durable_request.sequence)
    || payload.durable_request.sequence < 1
  ) {
    throw new Error("Archive is missing a valid monotonic writer sequence.");
  }
}

function eventKey(event) {
  if (event.event_id) return `id:${event.event_id}`;
  const composite = [event.participant_id, event.session_id, event.game_id, event.recorded_at, event.selected_move];
  return composite.every((value) => value !== undefined) ? `legacy:${composite.join("|")}` : `record:${JSON.stringify(event)}`;
}

function sessionKey(session) {
  return session.session_id ? `id:${session.session_id}` : `record:${JSON.stringify(session)}`;
}

function mergeRecords(existing, incoming, key) {
  return [...new Map([...existing, ...incoming].map((record) => [key(record), record])).values()];
}

export class StaleResearchSnapshotError extends Error {
  constructor(message) {
    super(message);
    this.name = "StaleResearchSnapshotError";
    this.code = "stale_snapshot";
  }
}

export async function writeResearchArchive(payload, directory = DEFAULT_DIRECTORY) {
  validateArchive(payload);
  await mkdir(directory, { recursive: true });
  const latest = path.join(directory, "ttt-research-latest.json");
  const previous = path.join(directory, "ttt-research-previous.json");
  let existing = null;
  try {
    existing = JSON.parse(await readFile(latest, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const { writer_id: writerId, sequence } = payload.durable_request;
  const writerSequences = { ...(existing?.durable_copy?.writer_sequences || {}) };
  if (sequence <= (writerSequences[writerId] || 0)) {
    throw new StaleResearchSnapshotError(`Snapshot ${sequence} from this browser is stale; the archive already has ${writerSequences[writerId]}.`);
  }
  writerSequences[writerId] = sequence;
  const archivePayload = {
    schema: payload.schema,
    events: mergeRecords(existing?.events || [], payload.events, eventKey),
    sessions: mergeRecords(existing?.sessions || [], payload.sessions, sessionKey),
  };
  const normalized = JSON.stringify(archivePayload);
  const archive = {
    ...archivePayload,
    durable_copy: {
      saved_at: new Date().toISOString(),
      sha256: createHash("sha256").update(normalized).digest("hex"),
      event_count: archivePayload.events.length,
      session_count: archivePayload.sessions.length,
      archive_id: existing?.durable_copy?.archive_id || randomUUID(),
      writer_id: writerId,
      writer_sequence: sequence,
      writer_sequences: writerSequences,
      merged: Boolean(existing && (archivePayload.events.length !== payload.events.length || archivePayload.sessions.length !== payload.sessions.length)),
    },
  };
  const temporary = path.join(directory, `.ttt-research-${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(archive, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (existing) {
    await copyFile(latest, previous);
  }
  await rename(temporary, latest);
  return archive.durable_copy;
}

export function tttResearchPersistence() {
  let writeQueue = Promise.resolve();
  return {
    name: "ttt-research-persistence",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url === "/api/ttt/archive" && request.method === "GET") {
          response.setHeader("Content-Type", "application/json");
          try {
            response.statusCode = 200;
            response.end(await readFile(path.join(DEFAULT_DIRECTORY, "ttt-research-latest.json"), "utf8"));
          } catch (error) {
            response.statusCode = error?.code === "ENOENT" ? 404 : 500;
            response.end(JSON.stringify({ ok: false, error: error?.code === "ENOENT" ? "No durable archive exists yet." : String(error) }));
          }
          return;
        }
        if (request.url !== "/api/ttt/persist" || request.method !== "POST") {
          next();
          return;
        }
        response.setHeader("Content-Type", "application/json");
        try {
          const payload = JSON.parse(await readRequest(request));
          const durableCopy = await (writeQueue = writeQueue.then(
            () => writeResearchArchive(payload),
            () => writeResearchArchive(payload),
          ));
          response.statusCode = 200;
          response.end(JSON.stringify({ ok: true, ...durableCopy }));
        } catch (error) {
          response.statusCode = error?.code === "stale_snapshot" ? 409 : 400;
          response.end(JSON.stringify({
            ok: false,
            code: error?.code || "invalid_archive",
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      });
    },
  };
}

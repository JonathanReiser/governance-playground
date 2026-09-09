const STORAGE_KEY = "governance-playground:ttt-decision-events:v1";
const PARTICIPANT_KEY = "governance-playground:ttt-participant:v1";
const SESSION_RESULTS_KEY = "governance-playground:ttt-session-results:v1";
const ACTIVE_SESSION_KEY = "governance-playground:ttt-active-session:v1";
const BACKUP_WRITER_KEY = "governance-playground:ttt-backup-writer:v1";
const BACKUP_SEQUENCE_KEY = "governance-playground:ttt-backup-sequence:v1";
export const CONSENT_VERSION = "2026-09-09.v1";

export function newSessionId() {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function readDecisionEvents(storage = localStorage) {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.filter((event) => event?.schema === "ttt-decision/v1") : [];
  } catch {
    return [];
  }
}

export function appendDecisionEvent(event, storage = localStorage) {
  try {
    const events = [...readDecisionEvents(storage), event];
    storage.setItem(STORAGE_KEY, JSON.stringify(events));
    return { ok: true, count: events.length, error: null };
  } catch (error) {
    return { ok: false, count: readDecisionEvents(storage).length, error: error instanceof Error ? error.message : String(error) };
  }
}

export function clearDecisionEvents(storage = localStorage) {
  storage.removeItem(STORAGE_KEY);
  storage.removeItem(SESSION_RESULTS_KEY);
  storage.removeItem(ACTIVE_SESSION_KEY);
}

export function readSessionResults(storage = localStorage) {
  try {
    const value = JSON.parse(storage.getItem(SESSION_RESULTS_KEY) || "[]");
    return Array.isArray(value) ? value.filter((result) => result?.schema === "ttt-session-result/v1") : [];
  } catch {
    return [];
  }
}

export function appendSessionResult(result, storage = localStorage) {
  try {
    const results = [...readSessionResults(storage), result];
    storage.setItem(SESSION_RESULTS_KEY, JSON.stringify(results));
    return { ok: true, count: results.length, error: null };
  } catch (error) {
    return { ok: false, count: readSessionResults(storage).length, error: error instanceof Error ? error.message : String(error) };
  }
}

export function setActiveResearchSession(sessionId, storage = localStorage) {
  storage.setItem(ACTIVE_SESSION_KEY, sessionId);
}

export function clearActiveResearchSession(storage = localStorage) {
  storage.removeItem(ACTIVE_SESSION_KEY);
}

export function readTrainingEvents(storage = localStorage) {
  const active = storage.getItem(ACTIVE_SESSION_KEY);
  return readDecisionEvents(storage).filter((event) => !active || event.session_id !== active);
}

function nextBackupRequest(storage) {
  let writerId = storage.getItem(BACKUP_WRITER_KEY);
  if (!writerId) {
    writerId = newSessionId();
    storage.setItem(BACKUP_WRITER_KEY, writerId);
  }
  const previous = Number.parseInt(storage.getItem(BACKUP_SEQUENCE_KEY) || "0", 10);
  const sequence = (Number.isSafeInteger(previous) && previous >= 0 ? previous : 0) + 1;
  storage.setItem(BACKUP_SEQUENCE_KEY, String(sequence));
  return { writer_id: writerId, sequence };
}

export async function persistResearchSnapshot(fetchImpl = globalThis.fetch, storage = globalThis.localStorage) {
  if (typeof fetchImpl !== "function" || !storage) return { ok: false, error: "Local file backup is unavailable." };
  try {
    const durableRequest = nextBackupRequest(storage);
    const response = await fetchImpl("/api/ttt/persist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schema: "ttt-research-export/v1",
        events: readDecisionEvents(storage),
        sessions: readSessionResults(storage),
        durable_request: durableRequest,
      }),
    });
    const result = await response.json();
    if (result.stale_write_ignored || result.code === "stale_snapshot") {
      return { ok: false, code: "stale_snapshot", error: result.error || "A newer local-backup snapshot already exists. This write was rejected." };
    }
    if (!response.ok || !result.ok) {
      return { ok: false, code: result.code, error: result.error || `Local backup failed with status ${response.status}.` };
    }
    if (result.writer_id !== durableRequest.writer_id || result.writer_sequence !== durableRequest.sequence) {
      return { ok: false, code: "backup_ack_mismatch", error: "The local backup did not acknowledge this exact snapshot." };
    }
    return {
      ok: true,
      eventCount: result.event_count,
      sessionCount: result.session_count,
      savedAt: result.saved_at,
      archiveId: result.archive_id,
      merged: Boolean(result.merged),
      error: null,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function restoreResearchSnapshot(fetchImpl = globalThis.fetch, storage = globalThis.localStorage) {
  if (typeof fetchImpl !== "function" || !storage) return { ok: false, error: "Local file recovery is unavailable." };
  try {
    const response = await fetchImpl("/api/ttt/archive");
    const archive = await response.json();
    if (!response.ok) return { ok: false, error: archive.error || `Recovery failed with status ${response.status}.` };
    if (archive?.schema !== "ttt-research-export/v1" || !Array.isArray(archive.events) || !Array.isArray(archive.sessions)) {
      return { ok: false, error: "The durable archive has an invalid format." };
    }
    const currentEvents = readDecisionEvents(storage);
    const currentSessions = readSessionResults(storage);
    const eventKey = (event) => [event.session_id, event.game_id, event.recorded_at, event.selected_move].join("|");
    const events = [...new Map([...archive.events, ...currentEvents].map((event) => [eventKey(event), event])).values()];
    const sessions = [...new Map([...archive.sessions, ...currentSessions].map((session) => [session.session_id, session])).values()];
    storage.setItem(STORAGE_KEY, JSON.stringify(events));
    storage.setItem(SESSION_RESULTS_KEY, JSON.stringify(sessions));
    // Adopt an identity from the archive only when it is unambiguous. The durable
    // archive MERGES every write (see tttPersistencePlugin.js), so it accumulates
    // records from every participant who has ever used this checkout; events[0] is
    // whichever record happened to sort first, not "this person". Adopting it would
    // silently file a new participant's decisions under an earlier participant's id.
    // With exactly one id present the archive is one person's, and resuming as them
    // on a fresh browser is the intended recovery path.
    const archivedParticipants = [...new Set(events.map((event) => event.participant_id).filter(Boolean))];
    if (!storage.getItem(PARTICIPANT_KEY) && archivedParticipants.length === 1) {
      storage.setItem(PARTICIPANT_KEY, archivedParticipants[0]);
    }
    return { ok: true, eventCount: events.length, sessionCount: sessions.length, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function participantId(storage = localStorage) {
  try {
    const existing = storage.getItem(PARTICIPANT_KEY);
    if (existing) return existing;
    const created = newSessionId();
    storage.setItem(PARTICIPANT_KEY, created);
    return created;
  } catch {
    return newSessionId();
  }
}

export function replaceParticipant(storage = localStorage) {
  const created = newSessionId();
  storage.setItem(PARTICIPANT_KEY, created);
  return created;
}

export function exportDecisionEvents() {
  const blob = new Blob([JSON.stringify({ schema: "ttt-research-export/v1", events: readDecisionEvents(), sessions: readSessionResults() }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ttt-decisions-${new Date().toISOString().replaceAll(":", "-")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

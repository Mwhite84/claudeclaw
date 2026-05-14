import { join } from "path";

const HEARTBEAT_DIR = join(process.cwd(), ".claude", "claudeclaw");
const SESSIONS_FILE = join(HEARTBEAT_DIR, "sessions.json");

// ── Types ────────────────────────────────────────────────────────────────────

export interface ThreadSession {
  sessionId: string;
  threadId: string;
  /** ID of the channel (or parent channel for threads) this session belongs to. */
  parentChannelId?: string;
  /** Human-readable name of the channel (may be empty if lookup failed). */
  channelName?: string;
  createdAt: string;
  lastUsedAt: string;
  turnCount: number;
  compactWarned: boolean;
  /** True if this session was created via /attach rather than organic conversation. */
  attached?: boolean;
}

export interface ChannelSession {
  sessionId: string;
  channelId: string;
  /** Human-readable channel name (may be empty if lookup failed). */
  channelName: string;
  createdAt: string;
  lastUsedAt: string;
  turnCount: number;
  compactWarned: boolean;
  /** True if this session was created via /attach rather than organic conversation. */
  attached?: boolean;
}

interface SessionsData {
  threads: Record<string, ThreadSession>;
  channels: Record<string, ChannelSession>;
  /** Optional global session reference for Discord DM fallback.
   *  Stored in sessions.json so the /status command can display it,
   *  but the actual session data lives in session.json (legacy store). */
  global?: { sessionId: string } | null;
}

// ── Internal ─────────────────────────────────────────────────────────────────

let sessionsCache: SessionsData | null = null;

/** Migrate old data that only had `threads` to include `channels` too. */
function migrate(raw: Record<string, unknown>): SessionsData {
  const threads: Record<string, ThreadSession> = {};

  const rawThreads = raw.threads;
  if (rawThreads && typeof rawThreads === "object") {
    for (const [key, val] of Object.entries(rawThreads as Record<string, Record<string, unknown>>)) {
      threads[key] = {
        sessionId: String(val.sessionId ?? ""),
        threadId: String(val.threadId ?? key),
        ...(typeof val.parentChannelId === "string" ? { parentChannelId: val.parentChannelId } : {}),
        ...(typeof val.channelName === "string" ? { channelName: val.channelName } : {}),
        createdAt: String(val.createdAt ?? new Date().toISOString()),
        lastUsedAt: String(val.lastUsedAt ?? new Date().toISOString()),
        turnCount: typeof val.turnCount === "number" ? val.turnCount : 0,
        compactWarned: typeof val.compactWarned === "boolean" ? val.compactWarned : false,
        ...(typeof val.attached === "boolean" ? { attached: val.attached } : {}),
      };
    }
  }

  const channels: Record<string, ChannelSession> = {};
  const rawChannels = raw.channels;
  if (rawChannels && typeof rawChannels === "object") {
    for (const [key, val] of Object.entries(rawChannels as Record<string, Record<string, unknown>>)) {
      channels[key] = {
        sessionId: String(val.sessionId ?? ""),
        channelId: String(val.channelId ?? key),
        channelName: typeof val.channelName === "string" ? val.channelName : "",
        createdAt: String(val.createdAt ?? new Date().toISOString()),
        lastUsedAt: String(val.lastUsedAt ?? new Date().toISOString()),
        turnCount: typeof val.turnCount === "number" ? val.turnCount : 0,
        compactWarned: typeof val.compactWarned === "boolean" ? val.compactWarned : false,
        ...(typeof val.attached === "boolean" ? { attached: val.attached } : {}),
      };
    }
  }

  const global = raw.global ?? null;

  return { threads, channels, global: global as SessionsData["global"] };
}

async function loadSessions(): Promise<SessionsData> {
  if (sessionsCache) return sessionsCache;
  try {
    const raw = await Bun.file(SESSIONS_FILE).json();
    sessionsCache = migrate(raw as Record<string, unknown>);
    return sessionsCache;
  } catch {
    sessionsCache = { threads: {}, channels: {} };
    return sessionsCache;
  }
}

async function saveSessions(data: SessionsData): Promise<void> {
  sessionsCache = data;
  await Bun.write(SESSIONS_FILE, JSON.stringify(data, null, 2) + "\n");
}

/** Invalidate the in-memory cache. Useful for tests or forced re-reads. */
export function invalidateCache(): void {
  sessionsCache = null;
}

// ── Thread session helpers (preserved from original) ──────────────────────────

/** Get session for a thread. Returns null if no session exists yet. */
export async function getThreadSession(
  threadId: string,
): Promise<{ sessionId: string; turnCount: number; compactWarned: boolean } | null> {
  const data = await loadSessions();
  const session = data.threads[threadId];
  if (!session) return null;

  if (typeof session.turnCount !== "number") session.turnCount = 0;
  if (typeof session.compactWarned !== "boolean") session.compactWarned = false;

  session.lastUsedAt = new Date().toISOString();
  await saveSessions(data);

  return {
    sessionId: session.sessionId,
    turnCount: session.turnCount,
    compactWarned: session.compactWarned,
  };
}

/** Create a new thread session after Claude outputs a session_id. */
export async function createThreadSession(
  threadId: string,
  sessionId: string,
  opts?: { parentChannelId?: string; channelName?: string; attached?: boolean },
): Promise<void> {
  const data = await loadSessions();
  data.threads[threadId] = {
    sessionId,
    threadId,
    ...(opts?.parentChannelId ? { parentChannelId: opts.parentChannelId } : {}),
    ...(opts?.channelName !== undefined ? { channelName: opts.channelName } : {}),
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    turnCount: 0,
    compactWarned: false,
    ...(opts?.attached ? { attached: true } : {}),
  };
  await saveSessions(data);
}

/** Remove a thread session (e.g., on thread delete/archive or /reset scoped to thread). */
export async function removeThreadSession(threadId: string): Promise<void> {
  const data = await loadSessions();
  if (!data.threads[threadId]) return;
  delete data.threads[threadId];
  await saveSessions(data);
}

/** Increment turn counter for a thread session. */
export async function incrementThreadTurn(threadId: string): Promise<number> {
  const data = await loadSessions();
  const session = data.threads[threadId];
  if (!session) return 0;
  if (typeof session.turnCount !== "number") session.turnCount = 0;
  session.turnCount += 1;
  await saveSessions(data);
  return session.turnCount;
}

/** Mark compact warning sent for a thread session. */
export async function markThreadCompactWarned(threadId: string): Promise<void> {
  const data = await loadSessions();
  const session = data.threads[threadId];
  if (!session) return;
  session.compactWarned = true;
  await saveSessions(data);
}

/** List all active thread sessions. */
export async function listThreadSessions(): Promise<ThreadSession[]> {
  const data = await loadSessions();
  return Object.values(data.threads);
}

/** Peek at a thread session without updating lastUsedAt. */
export async function peekThreadSession(threadId: string): Promise<ThreadSession | null> {
  const data = await loadSessions();
  return data.threads[threadId] ?? null;
}

// ── Channel session helpers ──────────────────────────────────────────────────

/** Get session for a Discord channel. Returns null if no session exists yet. */
export async function getChannelSession(
  channelId: string,
): Promise<{ sessionId: string; turnCount: number; compactWarned: boolean; channelName: string } | null> {
  const data = await loadSessions();
  const session = data.channels[channelId];
  if (!session) return null;

  if (typeof session.turnCount !== "number") session.turnCount = 0;
  if (typeof session.compactWarned !== "boolean") session.compactWarned = false;

  session.lastUsedAt = new Date().toISOString();
  await saveSessions(data);

  return {
    sessionId: session.sessionId,
    turnCount: session.turnCount,
    compactWarned: session.compactWarned,
    channelName: session.channelName ?? "",
  };
}

/** Create a new channel session. channelName may be empty if lookup failed. */
export async function createChannelSession(
  channelId: string,
  sessionId: string,
  channelName: string,
  attached?: boolean,
): Promise<void> {
  const data = await loadSessions();
  data.channels[channelId] = {
    sessionId,
    channelId,
    channelName,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    turnCount: 0,
    compactWarned: false,
    ...(attached ? { attached: true } : {}),
  };
  await saveSessions(data);
}

/** Remove a channel session (e.g., /reset scoped to channel). */
export async function removeChannelSession(channelId: string): Promise<void> {
  const data = await loadSessions();
  if (!data.channels[channelId]) return;
  delete data.channels[channelId];
  await saveSessions(data);
}

/** Increment turn counter for a channel session. */
export async function incrementChannelTurn(channelId: string): Promise<number> {
  const data = await loadSessions();
  const session = data.channels[channelId];
  if (!session) return 0;
  if (typeof session.turnCount !== "number") session.turnCount = 0;
  session.turnCount += 1;
  await saveSessions(data);
  return session.turnCount;
}

/** Mark compact warning sent for a channel session. */
export async function markChannelCompactWarned(channelId: string): Promise<void> {
  const data = await loadSessions();
  const session = data.channels[channelId];
  if (!session) return;
  session.compactWarned = true;
  await saveSessions(data);
}

/** List all active channel sessions. */
export async function listChannelSessions(): Promise<ChannelSession[]> {
  const data = await loadSessions();
  return Object.values(data.channels);
}

/** Count active channel sessions (excludes threads). Used for maxChannelSessions cap check. */
export async function countChannelSessions(): Promise<number> {
  const data = await loadSessions();
  return Object.keys(data.channels).length;
}

/** Peek at a channel session without updating lastUsedAt. */
export async function peekChannelSession(channelId: string): Promise<ChannelSession | null> {
  const data = await loadSessions();
  return data.channels[channelId] ?? null;
}

// ── Bulk helpers for /reset --all and /compact --all ─────────────────────────

/** Remove all thread and channel sessions. Used by /reset --all. */
export async function clearAllSessions(): Promise<{ threads: number; channels: number }> {
  const data = await loadSessions();
  const threadCount = Object.keys(data.threads).length;
  const channelCount = Object.keys(data.channels).length;
  data.threads = {};
  data.channels = {};
  await saveSessions(data);
  return { threads: threadCount, channels: channelCount };
}

/** List all Discord-scoped sessions (channels + threads) for status display. */
export async function listDiscordSessions(): Promise<{
  channels: ChannelSession[];
  threads: ThreadSession[];
}> {
  const data = await loadSessions();
  return {
    channels: Object.values(data.channels),
    threads: Object.values(data.threads),
  };
}

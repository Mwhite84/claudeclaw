import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdir, rm } from "fs/promises";
import {
  createThreadSession,
  getThreadSession,
  removeThreadSession,
  incrementThreadTurn,
  markThreadCompactWarned,
  listThreadSessions,
  peekThreadSession,
  createChannelSession,
  getChannelSession,
  removeChannelSession,
  incrementChannelTurn,
  markChannelCompactWarned,
  listChannelSessions,
  countChannelSessions,
  peekChannelSession,
  clearAllSessions,
  listDiscordSessions,
  invalidateCache,
} from "../sessionManager";

const TMP = join(process.cwd(), ".claude", "claudeclaw");
const SESSIONS_FILE = join(TMP, "sessions.json");

// We use the real sessionManager which reads from the real path.
// To isolate tests we'll write fixture data directly and invalidate the cache.

// sessionManager uses a module-level cache. We reset it by removing the file.
async function resetStore(): Promise<void> {
  invalidateCache();
  try { await rm(SESSIONS_FILE); } catch {}
}

async function writeFixture(data: Record<string, unknown>): Promise<void> {
  await mkdir(TMP, { recursive: true });
  await Bun.write(SESSIONS_FILE, JSON.stringify(data, null, 2) + "\n");
}

describe("sessionManager", () => {
  afterEach(resetStore);

  // ── Migration ────────────────────────────────────────────────────────────

  describe("migration", () => {
    test("loads legacy sessions.json with only threads", async () => {
      await writeFixture({
        threads: {
          "123456": {
            sessionId: "aaaa-bbbb-cccc",
            threadId: "123456",
            createdAt: "2025-01-01T00:00:00Z",
            lastUsedAt: "2025-01-01T00:00:00Z",
            turnCount: 3,
            compactWarned: false,
          },
        },
      });

      const sessions = await listThreadSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].sessionId).toBe("aaaa-bbbb-cccc");
      expect(sessions[0].turnCount).toBe(3);
    });

    test("loads empty sessions.json and initializes channels", async () => {
      await writeFixture({ threads: {} });
      const channels = await listChannelSessions();
      expect(channels).toEqual([]);
    });

    test("backfills missing turnCount and compactWarned", async () => {
      await writeFixture({
        threads: {
          "999": {
            sessionId: "xx-yy-zz",
            threadId: "999",
            createdAt: "2025-01-01T00:00:00Z",
            lastUsedAt: "2025-01-01T00:00:00Z",
          },
        },
      });
      const s = await getThreadSession("999");
      expect(s).not.toBeNull();
      expect(s!.turnCount).toBe(0);
      expect(s!.compactWarned).toBe(false);
    });
  });

  // ── Thread sessions ─────────────────────────────────────────────────────

  describe("thread sessions", () => {
    test("round-trips a thread session with parentChannelId and channelName", async () => {
      await resetStore();
      await createThreadSession("t1", "session-1", {
        parentChannelId: "chan-1",
        channelName: "#general",
      });
      const peeked = await peekThreadSession("t1");
      expect(peeked).not.toBeNull();
      expect(peeked!.parentChannelId).toBe("chan-1");
      expect(peeked!.channelName).toBe("#general");
      expect(peeked!.sessionId).toBe("session-1");
    });

    test("increments turn count", async () => {
      await resetStore();
      await createThreadSession("t2", "session-2");
      const turn1 = await incrementThreadTurn("t2");
      const turn2 = await incrementThreadTurn("t2");
      expect(turn1).toBe(1);
      expect(turn2).toBe(2);
    });

    test("marks compact warned", async () => {
      await resetStore();
      await createThreadSession("t3", "session-3");
      await markThreadCompactWarned("t3");
      const s = await getThreadSession("t3");
      expect(s!.compactWarned).toBe(true);
    });

    test("removes a thread session", async () => {
      await resetStore();
      await createThreadSession("t4", "session-4");
      await removeThreadSession("t4");
      const s = await peekThreadSession("t4");
      expect(s).toBeNull();
    });
  });

  // ── Channel sessions ────────────────────────────────────────────────────

  describe("channel sessions", () => {
    test("creates and retrieves a channel session", async () => {
      await resetStore();
      await createChannelSession("ch1", "session-ch1", "#dev");
      const s = await getChannelSession("ch1");
      expect(s).not.toBeNull();
      expect(s!.sessionId).toBe("session-ch1");
      expect(s!.channelName).toBe("#dev");
    });

    test("stores empty channelName when lookup fails", async () => {
      await resetStore();
      await createChannelSession("ch2", "session-ch2", "");
      const s = await peekChannelSession("ch2");
      expect(s!.channelName).toBe("");
    });

    test("increments channel turn count", async () => {
      await resetStore();
      await createChannelSession("ch3", "session-ch3", "test");
      expect(await incrementChannelTurn("ch3")).toBe(1);
      expect(await incrementChannelTurn("ch3")).toBe(2);
    });

    test("marks channel compact warned", async () => {
      await resetStore();
      await createChannelSession("ch4", "session-ch4", "test");
      await markChannelCompactWarned("ch4");
      const s = await getChannelSession("ch4");
      expect(s!.compactWarned).toBe(true);
    });

    test("removes a channel session", async () => {
      await resetStore();
      await createChannelSession("ch5", "session-ch5", "test");
      await removeChannelSession("ch5");
      expect(await peekChannelSession("ch5")).toBeNull();
    });

    test("lists channel sessions", async () => {
      await resetStore();
      await createChannelSession("ch6", "s6", "a");
      await createChannelSession("ch7", "s7", "b");
      const list = await listChannelSessions();
      expect(list.length).toBe(2);
    });
  });

  // ── Counting ────────────────────────────────────────────────────────────

  describe("countChannelSessions", () => {
    test("counts channels only, excluding threads", async () => {
      await resetStore();
      await createChannelSession("c1", "s1", "a");
      await createChannelSession("c2", "s2", "b");
      await createThreadSession("t1", "s3");
      expect(await countChannelSessions()).toBe(2);
    });

    test("returns 0 when no channel sessions exist", async () => {
      await resetStore();
      await createThreadSession("t1", "s1");
      expect(await countChannelSessions()).toBe(0);
    });
  });

  // ── Bulk helpers ────────────────────────────────────────────────────────

  describe("clearAllSessions", () => {
    test("clears both channels and threads", async () => {
      await resetStore();
      await createChannelSession("c1", "s1", "a");
      await createThreadSession("t1", "s2");
      const result = await clearAllSessions();
      expect(result.threads).toBe(1);
      expect(result.channels).toBe(1);
      expect(await listChannelSessions()).toEqual([]);
      expect(await listThreadSessions()).toEqual([]);
    });
  });

  describe("listDiscordSessions", () => {
    test("returns both channels and threads", async () => {
      await resetStore();
      await createChannelSession("c1", "s1", "a");
      await createThreadSession("t1", "s2");
      const result = await listDiscordSessions();
      expect(result.channels.length).toBe(1);
      expect(result.threads.length).toBe(1);
    });
  });

  // ── Backward compatibility ──────────────────────────────────────────────

  describe("backward compatibility", () => {
    test("existing sessions.json with only threads survives a write cycle", async () => {
      await writeFixture({
        threads: {
          "111": {
            sessionId: "old-session",
            threadId: "111",
            createdAt: "2025-01-01T00:00:00Z",
            lastUsedAt: "2025-01-01T00:00:00Z",
            turnCount: 5,
            compactWarned: true,
          },
        },
      });

      // Trigger a load + write
      await createChannelSession("222", "new-session", "test");

      // Re-read the file to verify the old thread data persisted
      const raw = await Bun.file(SESSIONS_FILE).json();
      expect(raw.threads["111"]).toBeDefined();
      expect(raw.threads["111"].sessionId).toBe("old-session");
      expect(raw.threads["111"].turnCount).toBe(5);
      expect(raw.channels["222"]).toBeDefined();
      expect(raw.channels["222"].channelName).toBe("test");
    });
  });
});

/**
 * Regression tests for the ClaudeClaw Personal Fork epic.
 *
 * Covers: session isolation, channel cap, scoped reset, recall injection,
 * memo-channel payload, attach stale-session choice, migration safety,
 * and Hindsight failure paths.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdir, rm } from "fs/promises";
import {
  createThreadSession,
  createChannelSession,
  getThreadSession,
  getChannelSession,
  removeThreadSession,
  removeChannelSession,
  peekThreadSession,
  peekChannelSession,
  countChannelSessions,
  clearAllSessions,
  listDiscordSessions,
  invalidateCache,
} from "../sessionManager";
import {
  isSubstantive,
  flushSessionToHindsight,
  formatMemories,
  recall,
  type RecallResultItem,
  type FlushMetadata,
} from "../hindsight";
import type { HindsightConfig } from "../config";

const TMP = join(process.cwd(), ".claude", "claudeclaw");
const SESSIONS_FILE = join(TMP, "sessions.json");

const disabledCfg: HindsightConfig = {
  baseUrl: "",
  token: "",
  bankId: "",
  recallMaxItems: 5,
  recallMaxChars: 4000,
  timeoutMs: 5000,
};

async function resetStore(): Promise<void> {
  invalidateCache();
  try { await rm(SESSIONS_FILE); } catch {}
}

async function writeFixture(data: Record<string, unknown>): Promise<void> {
  await mkdir(TMP, { recursive: true });
  await Bun.write(SESSIONS_FILE, JSON.stringify(data, null, 2) + "\n");
}

// ── Session Isolation ──────────────────────────────────────────────────────

describe("session isolation", () => {
  afterEach(resetStore);

  test("channel and thread sessions are independent", async () => {
    await createChannelSession("ch-1", "sess-channel-1", "general");
    await createThreadSession("th-1", "sess-thread-1", {
      parentChannelId: "ch-1",
      channelName: "sub-topic",
    });

    const channel = await getChannelSession("ch-1");
    const thread = await getThreadSession("th-1");

    expect(channel).not.toBeNull();
    expect(thread).not.toBeNull();
    expect(channel!.sessionId).toBe("sess-channel-1");
    expect(thread!.sessionId).toBe("sess-thread-1");

    // Thread and channel have different session IDs
    expect(channel!.sessionId).not.toBe(thread!.sessionId);
  });

  test("removing a channel session does not affect thread sessions", async () => {
    await createChannelSession("ch-1", "sess-channel-1", "general");
    await createThreadSession("th-1", "sess-thread-1");

    await removeChannelSession("ch-1");

    const channel = await peekChannelSession("ch-1");
    const thread = await peekThreadSession("th-1");
    expect(channel).toBeNull();
    expect(thread).not.toBeNull();
  });

  test("removing a thread session does not affect channel sessions", async () => {
    await createChannelSession("ch-1", "sess-channel-1", "general");
    await createThreadSession("th-1", "sess-thread-1");

    await removeThreadSession("th-1");

    const channel = await peekChannelSession("ch-1");
    const thread = await peekThreadSession("th-1");
    expect(channel).not.toBeNull();
    expect(thread).toBeNull();
  });

  test("clearAllSessions removes both channels and threads", async () => {
    await createChannelSession("ch-1", "sess-channel-1", "general");
    await createThreadSession("th-1", "sess-thread-1");

    const result = await clearAllSessions();
    expect(result.channels).toBe(1);
    expect(result.threads).toBe(1);

    const sessions = await listDiscordSessions();
    expect(sessions.channels.length).toBe(0);
    expect(sessions.threads.length).toBe(0);
  });
});

// ── Channel Cap ────────────────────────────────────────────────────────────

describe("channel cap enforcement", () => {
  afterEach(resetStore);

  test("countChannelSessions returns correct count", async () => {
    expect(await countChannelSessions()).toBe(0);

    await createChannelSession("ch-1", "sess-1", "general");
    expect(await countChannelSessions()).toBe(1);

    await createChannelSession("ch-2", "sess-2", "random");
    expect(await countChannelSessions()).toBe(2);
  });

  test("removing a channel session decrements the count", async () => {
    await createChannelSession("ch-1", "sess-1", "general");
    await createChannelSession("ch-2", "sess-2", "random");
    expect(await countChannelSessions()).toBe(2);

    await removeChannelSession("ch-1");
    expect(await countChannelSessions()).toBe(1);
  });

  test("thread sessions are not counted as channel sessions", async () => {
    await createChannelSession("ch-1", "sess-1", "general");
    await createThreadSession("th-1", "sess-thread-1");

    expect(await countChannelSessions()).toBe(1);
  });
});

// ── Scoped Reset ───────────────────────────────────────────────────────────

describe("scoped reset", () => {
  afterEach(resetStore);

  test("resetting one context leaves others untouched", async () => {
    await createChannelSession("ch-1", "sess-1", "general");
    await createChannelSession("ch-2", "sess-2", "random");
    await createThreadSession("th-1", "sess-thread-1");

    await removeChannelSession("ch-1");

    // ch-1 is gone
    expect(await peekChannelSession("ch-1")).toBeNull();
    // ch-2 and th-1 survive
    expect(await peekChannelSession("ch-2")).not.toBeNull();
    expect(await peekThreadSession("th-1")).not.toBeNull();
  });

  test("peek returns null for non-existent context (no-op case)", async () => {
    const channel = await peekChannelSession("nonexistent");
    const thread = await peekThreadSession("nonexistent");
    expect(channel).toBeNull();
    expect(thread).toBeNull();
  });
});

// ── Recall Injection ───────────────────────────────────────────────────────

describe("recall injection", () => {
  test("recall with disabled config returns empty block", async () => {
    const result = await recall(disabledCfg, "test query");
    expect(result.ok).toBe(true);
    expect(result.block).toBe("");
  });

  test("recall with empty query returns empty block", async () => {
    const result = await recall(disabledCfg, "");
    expect(result.ok).toBe(true);
    expect(result.block).toBe("");
  });

  test("formatted recall block is bounded to maxChars", () => {
    const items: RecallResultItem[] = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      text: "x".repeat(500),
    }));
    const block = formatMemories(items, 5, 4000);
    // With 5 items at 500 chars each, it should fit in 4000
    expect(block.length).toBeLessThanOrEqual(4000);
    expect(block).toContain("<hindsight_memories>");
  });

  test("malformed recall results are discarded", () => {
    const block = formatMemories(
      [{ id: "1", text: "" }, { id: "2", text: "   " }],
      5,
      4000,
    );
    expect(block).toBe("");
  });
});

// ── Memo-Channel Payload ───────────────────────────────────────────────────

describe("memo-channel payload", () => {
  test("isSubstantive accepts normal text for memo recall trigger", () => {
    expect(isSubstantive("Working on the API endpoint")).toBe(true);
    expect(isSubstantive("Voice transcript: I was debugging")).toBe(true);
  });

  test("isSubstantive rejects empty and noise", () => {
    expect(isSubstantive("")).toBe(false);
    expect(isSubstantive("👍")).toBe(false);
    expect(isSubstantive("/reset")).toBe(false);
  });
});

// ── Attach + Stale-Session ─────────────────────────────────────────────────

describe("attach session marking", () => {
  afterEach(resetStore);

  test("createChannelSession with attached flag sets attached=true", async () => {
    await createChannelSession("ch-1", "sess-1", "general", true);
    const session = await peekChannelSession("ch-1");
    expect(session).not.toBeNull();
    expect(session!.attached).toBe(true);
  });

  test("createThreadSession with attached flag sets attached=true", async () => {
    await createThreadSession("th-1", "sess-1", { attached: true });
    const session = await peekThreadSession("th-1");
    expect(session).not.toBeNull();
    expect(session!.attached).toBe(true);
  });

  test("normal session creation does not set attached", async () => {
    await createChannelSession("ch-1", "sess-1", "general");
    const session = await peekChannelSession("ch-1");
    expect(session).not.toBeNull();
    expect(session!.attached).toBeUndefined();
  });
});

// ── Migration Safety ───────────────────────────────────────────────────────

describe("migration safety", () => {
  afterEach(resetStore);

  test("existing thread sessions survive migration with new fields", async () => {
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
    invalidateCache();

    const session = await peekThreadSession("123456");
    expect(session).not.toBeNull();
    expect(session!.sessionId).toBe("aaaa-bbbb-cccc");
    expect(session!.turnCount).toBe(3);
  });

  test("existing channel sessions survive with all fields", async () => {
    await writeFixture({
      channels: {
        "789012": {
          sessionId: "dddd-eeee-ffff",
          channelId: "789012",
          channelName: "dev-chat",
          createdAt: "2025-01-01T00:00:00Z",
          lastUsedAt: "2025-01-01T00:00:00Z",
          turnCount: 5,
          compactWarned: true,
        },
      },
    });
    invalidateCache();

    const session = await peekChannelSession("789012");
    expect(session).not.toBeNull();
    expect(session!.sessionId).toBe("dddd-eeee-ffff");
    expect(session!.channelName).toBe("dev-chat");
    expect(session!.turnCount).toBe(5);
    expect(session!.compactWarned).toBe(true);
  });

  test("attached flag is preserved across load/save cycles", async () => {
    await createChannelSession("ch-1", "sess-1", "general", true);
    invalidateCache();

    // Re-read from disk
    const session = await peekChannelSession("ch-1");
    expect(session).not.toBeNull();
    expect(session!.attached).toBe(true);
  });

  test("empty store initializes cleanly", async () => {
    await resetStore();
    const sessions = await listDiscordSessions();
    expect(sessions.channels.length).toBe(0);
    expect(sessions.threads.length).toBe(0);
  });
});

// ── Hindsight Failure Paths ────────────────────────────────────────────────

describe("Hindsight failure paths", () => {
  test("flushSessionToHindsight returns ok when Hindsight is disabled", async () => {
    const result = await flushSessionToHindsight(disabledCfg, {
      sessionId: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.ok).toBe(true);
    expect(result.itemsSent).toBe(0);
  });

  test("flushSessionToHindsight returns ok when transcript is missing", async () => {
    const result = await flushSessionToHindsight(disabledCfg, {
      sessionId: "nonexistent-session-id",
      contextLabel: "discord:channel:general",
    });
    expect(result.ok).toBe(true);
    expect(result.itemsSent).toBe(0);
  });

  test("recall with disabled Hindsight does not block", async () => {
    const result = await recall(disabledCfg, "what was I working on?");
    expect(result.ok).toBe(true);
    expect(result.block).toBe("");
  });

  test("oversized recall block is discarded, not partially injected", () => {
    const items: RecallResultItem[] = [
      { id: "1", text: "A".repeat(200) },
      { id: "2", text: "B".repeat(200) },
    ];
    const block = formatMemories(items, 5, 120);
    expect(block).toBe(""); // discarded, not partial
  });
});

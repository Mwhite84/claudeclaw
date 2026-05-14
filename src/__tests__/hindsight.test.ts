import { describe, test, expect } from "bun:test";
import { formatMemories, isSubstantive, flushSessionToHindsight, type RecallResultItem, type FlushMetadata } from "../hindsight";
import type { HindsightConfig } from "../config";

const disabledCfg: HindsightConfig = {
  baseUrl: "",
  token: "",
  bankId: "",
  recallMaxItems: 5,
  recallMaxChars: 4000,
  timeoutMs: 5000,
};

describe("formatMemories", () => {
  test("returns empty string for empty input", () => {
    expect(formatMemories([], 5, 4000)).toBe("");
  });

  test("returns empty string for non-array input", () => {
    expect(formatMemories(null as unknown as RecallResultItem[], 5, 4000)).toBe("");
  });

  test("returns empty string when all items have empty text", () => {
    expect(formatMemories([{ id: "1", text: "" }, { id: "2", text: "   " }], 5, 4000)).toBe("");
  });

  test("formats a single memory into a hindsight_memories block", () => {
    const result = formatMemories(
      [{ id: "1", text: "Alice works at Google" }],
      5,
      4000,
    );
    expect(result).toContain("<hindsight_memories>");
    expect(result).toContain("<memory>Alice works at Google</memory>");
    expect(result).toContain("</hindsight_memories>");
    expect(result).toContain("recalled memories may be incomplete or stale");
  });

  test("includes context attribute when context is present", () => {
    const result = formatMemories(
      [{ id: "1", text: "hello", context: "discord:#general" }],
      5,
      4000,
    );
    expect(result).toContain('context="discord:#general"');
  });

  test("omits context attribute when context is empty", () => {
    const result = formatMemories(
      [{ id: "1", text: "hello", context: "" }],
      5,
      4000,
    );
    expect(result).not.toContain("context=");
  });

  test("caps items at maxItems", () => {
    const items: RecallResultItem[] = [
      { id: "1", text: "first" },
      { id: "2", text: "second" },
      { id: "3", text: "third" },
    ];
    const result = formatMemories(items, 2, 4000);
    expect(result).toContain("first");
    expect(result).toContain("second");
    expect(result).not.toContain("third");
  });

  test("escapes XML special characters in text", () => {
    const result = formatMemories(
      [{ id: "1", text: "A < B & C > D" }],
      5,
      4000,
    );
    expect(result).toContain("A &lt; B &amp; C &gt; D");
  });

  test("escapes quotes in context attribute", () => {
    const result = formatMemories(
      [{ id: "1", text: "hello", context: 'say "hi"' }],
      5,
      4000,
    );
    expect(result).toContain('context="say &quot;hi&quot;"');
  });

  test("discards block when total exceeds maxChars", () => {
    const items: RecallResultItem[] = [
      { id: "1", text: "A".repeat(200) },
      { id: "2", text: "B".repeat(200) },
    ];
    // 120 chars is too small to fit both even with truncation
    const result = formatMemories(items, 5, 120);
    expect(result).toBe("");
  });

  test("truncates individual items to fit within maxChars", () => {
    const items: RecallResultItem[] = [
      { id: "1", text: "A".repeat(300) },
    ];
    // 200 chars should be enough for one truncated item + overhead
    const result = formatMemories(items, 5, 200);
    expect(result).toContain("<hindsight_memories>");
    expect(result.length).toBeLessThanOrEqual(200);
  });

  test("returns well-formed block under normal conditions", () => {
    const items: RecallResultItem[] = [
      { id: "1", text: "User prefers dark mode", context: "discord:#dev" },
      { id: "2", text: "User is in PST timezone" },
    ];
    const result = formatMemories(items, 5, 4000);
    expect(result).toMatch(/^<hindsight_memories>/);
    expect(result).toMatch(/<\/hindsight_memories>$/);
    expect(result).toContain("User prefers dark mode");
    expect(result).toContain("User is in PST timezone");
  });
});

describe("isSubstantive", () => {
  test("returns false for empty string", () => {
    expect(isSubstantive("")).toBe(false);
  });

  test("returns false for whitespace only", () => {
    expect(isSubstantive("   ")).toBe(false);
  });

  test("returns false for control commands", () => {
    expect(isSubstantive("/reset")).toBe(false);
    expect(isSubstantive("/compact")).toBe(false);
    expect(isSubstantive("/status")).toBe(false);
  });

  test("returns false for pure emoji", () => {
    expect(isSubstantive("👍")).toBe(false);
    expect(isSubstantive("🎉 🎊")).toBe(false);
  });

  test("returns true for normal text", () => {
    expect(isSubstantive("Hello, how are you?")).toBe(true);
  });

  test("returns true for text with emoji", () => {
    expect(isSubstantive("Check this out 🚀")).toBe(true);
  });

  test("returns true for voice transcript", () => {
    expect(isSubstantive("Voice transcript: I was working on the API endpoint")).toBe(true);
  });

  test("returns true for short meaningful content", () => {
    expect(isSubstantive("yes")).toBe(true);
  });

  test("returns false for single punctuation", () => {
    expect(isSubstantive("?")).toBe(false);
    expect(isSubstantive("!")).toBe(false);
  });

  test("returns true for longer text", () => {
    expect(isSubstantive("Can you help me debug the authentication flow?")).toBe(true);
  });
});

describe("flushSessionToHindsight", () => {
  test("returns ok when Hindsight is disabled", async () => {
    const result = await flushSessionToHindsight(disabledCfg, {
      sessionId: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.ok).toBe(true);
    expect(result.itemsSent).toBe(0);
  });

  test("returns ok when transcript does not exist", async () => {
    const result = await flushSessionToHindsight(disabledCfg, {
      sessionId: "nonexistent-session-id",
      contextLabel: "discord:#test",
    });
    expect(result.ok).toBe(true);
    expect(result.itemsSent).toBe(0);
  });

  test("returns ok with minimal metadata", async () => {
    const result = await flushSessionToHindsight(disabledCfg, {
      sessionId: "00000000-0000-0000-0000-000000000002",
    });
    expect(result.ok).toBe(true);
  });
});

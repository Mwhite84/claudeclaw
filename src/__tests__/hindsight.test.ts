import { describe, test, expect } from "bun:test";
import { formatMemories, type RecallResultItem } from "../hindsight";

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

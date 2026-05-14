/**
 * Hindsight API client and memory formatting utilities.
 *
 * Provides retain (store) and recall (retrieve) calls against the real Hindsight
 * HTTP API, plus a bounded formatting helper that converts recall results into a
 * single `<hindsight_memories>` XML block suitable for injecting into Claude's
 * system prompt.
 *
 * Transport-agnostic: callers (Discord session lifecycle, etc.) import functions
 * from this module without duplicating HTTP logic.
 */

import type { HindsightConfig } from "./config";

// ── Types ────────────────────────────────────────────────────────────────────

/** Payload for a single memory item sent to the retain endpoint. */
export interface RetainItem {
  /** Natural-language content to store. */
  content: string;
  /** Optional context label (e.g. "discord:#general"). */
  context?: string;
  /** Optional document ID for upsert grouping. */
  document_id?: string;
  /** ISO-8601 timestamp of when the content occurred. */
  timestamp?: string;
  /** Optional string-keyed metadata attached to the memory. */
  metadata?: Record<string, string>;
  /** Optional tags for visibility scoping during recall. */
  tags?: string[];
}

/** A single result from the recall endpoint. */
export interface RecallResultItem {
  id: string;
  text: string;
  type?: string | null;
  entities?: string[] | null;
  context?: string | null;
  occurred_start?: string | null;
  occurred_end?: string | null;
  mentioned_at?: string | null;
  document_id?: string | null;
  metadata?: Record<string, string> | null;
  tags?: string[] | null;
}

/** Return type for the retain helper. */
export interface RetainOutcome {
  ok: boolean;
  /** Non-empty when ok is false. */
  error?: string;
}

/** Return type for the recall helper. */
export interface RecallOutcome {
  ok: boolean;
  /** Formatted `<hindsight_memories>` block. Empty string when ok is true but no results. */
  block: string;
  /** Non-empty when ok is false. */
  error?: string;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function isEnabled(cfg: HindsightConfig): boolean {
  return cfg.baseUrl.length > 0 && cfg.bankId.length > 0;
}

function baseUrl(cfg: HindsightConfig): string {
  return cfg.baseUrl.replace(/\/+$/, "");
}

function headers(cfg: HindsightConfig): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.token) h["Authorization"] = `Bearer ${cfg.token}`;
  return h;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Store one or more memory items via the Hindsight retain endpoint.
 *
 * Uses `async: true` so the call returns immediately after the server queues
 * the work — retain is non-blocking from ClaudeClaw's perspective.
 *
 * Returns `{ ok: true }` on success, `{ ok: false, error }` on any failure.
 * Callers are free to ignore errors; the conversation should continue regardless.
 */
export async function retain(
  cfg: HindsightConfig,
  items: RetainItem[],
): Promise<RetainOutcome> {
  if (!isEnabled(cfg)) return { ok: true };
  if (items.length === 0) return { ok: true };

  const url = `${baseUrl(cfg)}/v1/default/banks/${encodeURIComponent(cfg.bankId)}/memories`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headers(cfg),
      body: JSON.stringify({ items, async: true }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[hindsight] retain failed (${res.status}): ${body.slice(0, 200)}`);
      return { ok: false, error: `retain ${res.status}` };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[hindsight] retain error: ${msg}`);
    return { ok: false, error: msg };
  }
}

/**
 * Recall memories relevant to `query` and format them into a bounded
 * `<hindsight_memories>` XML block.
 *
 * The block is capped at `cfg.recallMaxItems` items and `cfg.recallMaxChars`
 * total characters. If the response is malformed or exceeds the character budget
 * even after truncation, it is discarded and a structured error is returned
 * instead of partial garbage.
 *
 * Returns `{ ok: true, block }` on success (block may be empty string if no
 * results matched), or `{ ok: false, error }` on failure.
 */
export async function recall(
  cfg: HindsightConfig,
  query: string,
  opts?: { query_timestamp?: string; tags?: string[] },
): Promise<RecallOutcome> {
  if (!isEnabled(cfg)) return { ok: true, block: "" };
  if (!query.trim()) return { ok: true, block: "" };

  const url = `${baseUrl(cfg)}/v1/default/banks/${encodeURIComponent(cfg.bankId)}/memories/recall`;

  const body: Record<string, unknown> = {
    query,
    max_tokens: 4096,
  };
  if (opts?.query_timestamp) body.query_timestamp = opts.query_timestamp;
  if (opts?.tags && opts.tags.length > 0) {
    body.tags = opts.tags;
    body.tags_match = "all_strict";
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headers(cfg),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[hindsight] recall failed (${res.status}): ${text.slice(0, 200)}`);
      return { ok: false, block: "", error: `recall ${res.status}` };
    }

    const json = await res.json();

    if (!json || !Array.isArray(json.results)) {
      console.warn("[hindsight] recall returned malformed response (missing results array)");
      return { ok: false, block: "", error: "malformed recall response" };
    }

    const block = formatMemories(
      json.results as RecallResultItem[],
      cfg.recallMaxItems,
      cfg.recallMaxChars,
    );

    return { ok: true, block };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[hindsight] recall error: ${msg}`);
    return { ok: false, block: "", error: msg };
  }
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Convert recall result items into a single `<hindsight_memories>` XML block.
 *
 * Rules:
 * - At most `maxItems` items are included.
 * - Total block length must not exceed `maxChars`; if truncating individual
 *   items doesn't bring it under budget, the entire block is discarded and
 *   an empty string is returned.
 * - Each item is rendered as `<memory>text</memory>` with an optional
 *   `context` attribute.
 * - A footer warning is appended noting memories may be incomplete or stale.
 */
export function formatMemories(
  items: RecallResultItem[],
  maxItems: number,
  maxChars: number,
): string {
  if (!Array.isArray(items) || items.length === 0) return "";

  const capped = items.slice(0, maxItems);

  const parts: string[] = [];
  for (const item of capped) {
    if (typeof item.text !== "string" || !item.text.trim()) continue;

    const ctx = typeof item.context === "string" && item.context.trim()
      ? ` context="${escapeAttr(item.context.trim())}"`
      : "";
    parts.push(`  <memory${ctx}>${escapeXml(item.text.trim())}</memory>`);
  }

  if (parts.length === 0) return "";

  const footer = "  Note: recalled memories may be incomplete or stale. Verify before relying on them.";
  const block = `<hindsight_memories>\n${parts.join("\n")}\n${footer}\n</hindsight_memories>`;

  if (block.length > maxChars) {
    // Try truncating individual memory texts
    const trimmed = tryTruncate(capped, maxItems, maxChars);
    if (trimmed === null) {
      console.warn(`[hindsight] recall block exceeded ${maxChars} chars after truncation; discarding`);
      return "";
    }
    return trimmed;
  }

  return block;
}

/**
 * Attempt to produce a valid block by shortening individual memory texts.
 * Returns null if it still can't fit within maxChars.
 */
function tryTruncate(
  items: RecallResultItem[],
  maxItems: number,
  maxChars: number,
): string | null {
  const footer = "  Note: recalled memories may be incomplete or stale. Verify before relying on them.";
  // Overhead estimate: opening + closing tags + footer + newlines
  const overhead = "<hindsight_memories>\n".length + "\n".length + footer.length + "\n</hindsight_memories>".length;
  const budgetPerItem = Math.floor((maxChars - overhead) / Math.min(items.length, maxItems));

  if (budgetPerItem < 30) return null; // not enough room for meaningful content

  const capped = items.slice(0, maxItems);
  const parts: string[] = [];
  for (const item of capped) {
    if (typeof item.text !== "string" || !item.text.trim()) continue;
    let text = item.text.trim();
    const ctx = typeof item.context === "string" && item.context.trim()
      ? ` context="${escapeAttr(item.context.trim())}"`
      : "";
    const tagOverhead = `  <memory${ctx}>`.length + "</memory>".length;
    const textBudget = budgetPerItem - tagOverhead;
    if (textBudget < 10) return null;
    if (text.length > textBudget) text = text.slice(0, textBudget - 3) + "...";
    parts.push(`  <memory${ctx}>${escapeXml(text)}</memory>`);
  }

  if (parts.length === 0) return null;
  const block = `<hindsight_memories>\n${parts.join("\n")}\n${footer}\n</hindsight_memories>`;
  return block.length <= maxChars ? block : null;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

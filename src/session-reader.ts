/**
 * Session Context Handoff Utilities
 *
 * Reads Claude Code session JSONL transcripts and formats them as context
 * blocks for injection into new sessions. Powers the /attach handoff flow.
 *
 * Session files live at: ~/.claude/projects/<project-slug>/<session-id>.jsonl
 * The project slug is the working directory with / replaced by - (leading / dropped).
 */

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface SessionSummary {
  sessionId: string;
  projectSlug: string;
  turnCount: number;
  firstTurn: string; // ISO timestamp
  lastTurn: string;  // ISO timestamp
  transcript: SessionTurn[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");

/** Max turns to include in handoff (keeps most recent context). */
const MAX_HANDOFF_TURNS = 20;

/** Where handoff files are stored between /attach and the next session spawn. */
export const HANDOFFS_DIR = join(process.cwd(), ".claude", "claudeclaw", "handoffs");

// Discord metadata prefix pattern: [timestamp]\n[Discord Channel: ...]\n[Discord from ...]
// We want to extract just the "Message: <value>" part.
const DISCORD_PREFIX_RE = /^\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*\n\[Discord[^\]]*\]\s*\n(?:\[Discord[^\]]*\]\s*\n)*Message:\s*/;

// ── JSONL entry types ─────────────────────────────────────────────────────────

interface JsonlUserEntry {
  type: "user";
  message: {
    role: "user";
    content: string | Array<{ type: string; text?: string }>;
  };
  timestamp?: string;
}

interface JsonlAssistantEntry {
  type: "assistant";
  message: {
    role: "assistant";
    content: string | Array<{ type: string; text?: string }>;
  };
  timestamp?: string;
}

type JsonlEntry = JsonlUserEntry | JsonlAssistantEntry | { type: string };

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Search ~/.claude/projects/ for a file named {sessionId}.jsonl in any project subdirectory.
 * Returns the full path if found, null otherwise.
 */
export function findSessionFile(sessionId: string): string | null {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return null;

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return null;
  }

  for (const dir of projectDirs) {
    const candidate = join(CLAUDE_PROJECTS_DIR, dir, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Strip Discord metadata boilerplate from user message content.
 * The format is: [timestamp]\n[Discord Channel: ...]\n[Discord from ...]\nMessage: <text>
 * Returns just the message value, or the original if no prefix matched.
 */
function stripDiscordPrefix(content: string): string {
  const match = content.match(DISCORD_PREFIX_RE);
  if (match) return content.slice(match[0].length).trim();
  return content.trim();
}

/**
 * Extract text content from a JSONL content field.
 * Handles both plain string content and content block arrays.
 * For arrays, joins only type:"text" blocks; skips tool_use and other types.
 */
function extractTextContent(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text!.trim())
    .join("\n")
    .trim();
}

/**
 * Read and parse a session JSONL transcript.
 * Returns a SessionSummary with all user/assistant turns extracted,
 * or null if the session file can't be found or parsed.
 */
export function readSessionTranscript(sessionId: string): SessionSummary | null {
  const filePath = findSessionFile(sessionId);
  if (!filePath) return null;

  // Extract project slug from directory name
  const parts = filePath.split(/[/\\]/);
  const projectSlug = parts[parts.length - 2] ?? "unknown";

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const lines = raw.split("\n").filter((l) => l.trim());
  const turns: SessionTurn[] = [];

  for (const line of lines) {
    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line) as JsonlEntry;
    } catch {
      continue;
    }

    // Skip non-conversation entries
    if (entry.type !== "user" && entry.type !== "assistant") continue;

    const typed = entry as JsonlUserEntry | JsonlAssistantEntry;
    const rawContent = typed.message?.content;
    if (!rawContent) continue;

    let text = extractTextContent(rawContent as string | Array<{ type: string; text?: string }>);
    if (!text) continue; // skip turns that are purely tool calls (no text blocks)

    // Strip Discord metadata boilerplate from user messages
    if (typed.type === "user") {
      text = stripDiscordPrefix(text);
    }

    if (!text) continue;

    turns.push({
      role: typed.type as "user" | "assistant",
      content: text,
      timestamp: typed.timestamp ?? new Date().toISOString(),
    });
  }

  if (turns.length === 0) return null;

  return {
    sessionId,
    projectSlug,
    turnCount: turns.length,
    firstTurn: turns[0]!.timestamp,
    lastTurn: turns[turns.length - 1]!.timestamp,
    transcript: turns,
  };
}

/**
 * Format a SessionSummary into a readable context block for injection.
 * Truncates to the last MAX_HANDOFF_TURNS turns so long sessions don't blow context.
 */
export function buildContextHandoff(summary: SessionSummary): string {
  const { sessionId, turnCount, firstTurn, lastTurn, transcript } = summary;

  const truncated = transcript.length > MAX_HANDOFF_TURNS
    ? transcript.slice(transcript.length - MAX_HANDOFF_TURNS)
    : transcript;

  const dateRange = firstTurn !== lastTurn
    ? `${fmtDate(firstTurn)} – ${fmtDate(lastTurn)}`
    : fmtDate(firstTurn);

  const lines: string[] = [
    `## Context from session ${sessionId} (${turnCount} turns, ${dateRange})`,
    "",
  ];

  if (transcript.length > MAX_HANDOFF_TURNS) {
    lines.push(`*(showing last ${MAX_HANDOFF_TURNS} of ${turnCount} turns)*`, "");
  }

  for (const turn of truncated) {
    lines.push(fmtDate(turn.timestamp));
    const label = turn.role === "user" ? "User" : "Lumen";
    // Indent content and cap individual turn length
    const content = turn.content.length > 1500
      ? turn.content.slice(0, 1500) + "…"
      : turn.content;
    lines.push(`${label}: ${content}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("You are continuing work that started in the above session. Pick up naturally.");

  return lines.join("\n");
}

// ── Handoff file I/O ──────────────────────────────────────────────────────────

/**
 * Write a handoff file to disk so the next session spawn can pick it up.
 *
 * Files are keyed by scopeId (channel ID or thread ID) so the spawn-side lookup
 * can find the handoff without knowing the source session ID. The source session
 * ID is embedded in the file content for reference only.
 */
export function writeHandoffFile(scopeId: string, content: string): void {
  mkdirSync(HANDOFFS_DIR, { recursive: true });
  writeFileSync(join(HANDOFFS_DIR, `${scopeId}.txt`), content, "utf8");
}

/**
 * Read and delete a handoff file. Returns its content, or null if not found.
 * Keyed by the same scopeId (channel/thread ID) used when writing.
 * Atomic consume — once read the file is gone.
 */
export function consumeHandoffFile(scopeId: string): string | null {
  const path = join(HANDOFFS_DIR, `${scopeId}.txt`);
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf8");
    unlinkSync(path);
    return content;
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  } catch {
    return iso;
  }
}

---
description: Catch up on recent work using Hindsight memory recall. Usage: /catchup [optional topic or timeframe]
---

Surface what Morgan was working on recently by querying Hindsight. The goal is a concise, useful briefing — not a raw memory dump.

## Instructions

The user may invoke this with or without arguments:
- `/catchup` — recall recent work across all contexts
- `/catchup trading bot` — focus on a specific topic
- `/catchup yesterday` — focus on a time window
- `/catchup where we left off with the signal engine` — natural language is fine

**Step 1 — Build the query**

If the user provided arguments, use them verbatim as the recall query. If no arguments, use: `"what was Morgan working on today"`

Append the current date and time to the query so Hindsight's temporal reasoning kicks in (e.g. "what was Morgan working on today — current time: 2026-05-14 12:30 UTC-5").

**Step 2 — Recall from Hindsight**

Use the `mcp__plugin_hindsight-memory_hindsight__agent_knowledge_recall` tool with the query. Request `max_tokens: 2048` to get a rich result set.

Also do a second recall specifically for recent voice memos: query `"personal note voice memo"` with `max_tokens: 1024`.

**Step 3 — Synthesize a briefing**

Merge both result sets and write a catch-up briefing. Format:

**What you were working on:**
[1-2 sentence summary of the main topic/task]

**Where you left off:**
[Key decisions made, current state, what was unresolved]

**What you were thinking about:**
[Any open questions, approaches being considered, things to remember]

**Next steps (if clear):**
[Only if the memories suggest a clear next action]

Keep it tight. If the memories don't have enough signal for a section, skip it. No filler, no "I found X memories about Y" preamble. Just the briefing.

If Hindsight returns nothing relevant, say so plainly: "Nothing in memory for that — either it hasn't been captured yet or the timeframe is too far back."

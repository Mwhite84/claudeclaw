# ClaudeClaw Fork — Product Requirements Document

**Owner:** Morgan (ironeagle84)  
**Date:** 2026-05-13  
**Scope:** Fork of moazbuilds/claudeclaw (Mwhite84/claudeclaw) — personal enhancements

---

## Context

ClaudeClaw is a daemon that bridges Discord, Telegram, and the Claude CLI into persistent AI sessions. This fork addresses real operational pain points discovered through daily use, and adds capabilities that fit Morgan's specific workflow: multi-surface communication, voice capture, Hindsight memory integration, automation pipelines, and clean context isolation.

---

## Problem Statement

### What's broken today

1. **All channels share one session.** Every Discord channel in `listenChannels` feeds into a single global Claude session. When multiple channels are active, context bleeds — a message in `#automations` can corrupt a conversation in `#trading`. The user is forced to either thread everything or accept polluted context.

2. **Thread replies land in the main channel.** `DiscordMessage` was missing the `thread_id` field, so all replies defaulted to `channel_id`. (Fixed in patch 2026-05-13, but should be upstreamed to this fork.)

3. **No voice-to-memory path.** Voice memos captured via nmemo or Telegram voice have no direct route into Hindsight. Transcription happens but the content evaporates.

4. **Session dropout after inactivity.** After 5+ minutes without activity, the ClaudeClaw listener stops reliably receiving Discord messages. Root cause is a combination of thread archival behavior and session state loss.

5. **No awareness of Hindsight.** ClaudeClaw has no concept of long-term memory. Every conversation starts cold. There's no mechanism to inject remembered context or flush session learnings to the memory layer.

---

## Requirements

### P0 — Session Isolation (Core Architecture Change)

**FR-01: Per-channel session scoping**

Every Discord channel in `listenChannels` should have its own isolated Claude session, keyed by `channelId`. The global session should only be used as a last resort fallback (e.g., DMs with no session history).

- Sessions stored in `sessions.json` under a `channels` key alongside `threads`
- Each channel session is resumed independently with `--resume`
- Channel sessions should be configurable: `sessionPerChannel: true | false` (default: `true`)
- Existing behavior (global session) preserved when disabled for backward compatibility
- **Session cap: max 5 concurrent channel sessions.** If a 6th channel becomes active, the bot replies with an alert: `"⚠️ Session limit reached (5/5). Close or clear an existing session before starting a new one."` and does not spawn a new Claude process. Threads within a channel do not count against the channel cap — they share the channel session's slot.

**FR-02: Thread isolation unchanged**

Thread sessions already work correctly (per-thread via `channelId`). The fix already applied (thread_id routing) should be formalized and tested.

**FR-03: Session metadata per context**

Each channel/thread session should carry:
- `createdAt`, `lastUsedAt`, `turnCount`
- `channelName` (human-readable label for logs/status)
- `compactWarned` flag
- Optional `label` — user-defined alias for the session

**FR-04: `/clear` scoped by context**

`/claudeclaw:clear` should clear the session for the current channel or thread only, not the global session. Add `--all` flag for full reset.

---

### P0 — Thread Routing Fix (already patched, formalize)

**FR-05: thread_id in DiscordMessage**

Add `thread_id?: string` to the `DiscordMessage` interface. Use `message.thread_id ?? message.channel_id` as `channelId` for all reply operations.

---

### P1 — Hindsight Integration

Morgan runs Hindsight (vectorize.io, local Docker) as his second brain. ClaudeClaw should be Hindsight-aware.

**FR-06: Session → Hindsight flush**

At session end (manual clear, compact, or rotation), ClaudeClaw should:
1. Serialize the conversation transcript
2. POST it to the Hindsight ingest endpoint (configurable URL + auth token)
3. Log success/failure

Config:
```json
"hindsight": {
  "enabled": true,
  "endpoint": "http://localhost:8080/ingest",
  "token": "<bearer>",
  "flushOnClear": true,
  "flushOnRotate": true,
  "bankId": "morgan-personal"
}
```

**FR-07: Lazy memory injection (first query per session)**

Hindsight recall is triggered on the **first substantive message** in a session, not at session start. This avoids wasting a recall call on sessions that immediately die or are just noise.

Behavior:
1. Session starts — no Hindsight call yet
2. First message received — ClaudeClaw queries Hindsight `/recall` using channel name + message content as context
3. Recalled memories injected as `<hindsight_memories>` block into that message's context
4. Recall result cached for the remainder of the session (no re-query per turn)
5. If Hindsight is unreachable, proceed without memories and log a warning — never block the session

**FR-08: nmemo as a built-in ClaudeClaw skill**

nmemo (voice memo → Hindsight) is implemented as a native ClaudeClaw skill, not a standalone tool. This avoids a separate deployment, reuses the existing Whisper pipeline and Hindsight config already wired into ClaudeClaw, and keeps everything in one process.

ClaudeClaw already transcribes Discord voice messages via local Whisper (bundled, no API cost). Extend this to route transcripts into Hindsight.

Two delivery modes:

**Mode A — Memo channels** (`memoChannels: []` in discord config):
- Any message (voice or text) sent to a designated memo channel goes straight to Hindsight
- No Claude session spun up; no response generated
- React with ✅ to confirm ingestion
- Clean capture path: record → transcribe → ingest

**Mode B — Intent-based anywhere** (`/memo` command or `memo:` prefix after transcription):
- Works in any channel or thread
- Routes content to Hindsight first, then optionally processes with Claude
- Useful for capturing mid-conversation thoughts

**FR-08a: Whisper quality-based model routing**

Not all audio is created equal. Car memos (road noise, bluetooth, wind) are far harder than desk memos. Add a confidence-based escalation tier:

1. Transcribe with local Whisper large-v3-turbo (default for all voice — handles most cases)
2. Score confidence via Whisper's per-token log probabilities
3. If avg confidence below configurable threshold: re-transcribe with remote API (OpenAI Whisper or Deepgram)
4. Tag low-confidence transcripts with `[low_confidence]` before Hindsight ingest

Config:
```json
"stt": {
  "model": "large-v3-turbo",
  "confidenceThreshold": 0.7,
  "fallbackRemote": {
    "enabled": true,
    "provider": "openai",
    "model": "whisper-1"
  }
}
```

This keeps cost near-zero for clean audio and escalates to remote only for genuinely noisy recordings (typically 1–2¢/memo).

---

### P1 — Dropout / Reliability Fixes

**FR-09: Heartbeat watchdog for Discord gateway**

The Discord WebSocket gateway can silently go stale. Add a watchdog that:
- Pings the gateway every 30 seconds
- If no PONG or MESSAGE_CREATE within a configurable window, reconnects
- Emits a log entry on reconnect with reason

**FR-10: Thread archival recovery**

When Discord fires `THREAD_UPDATE` with `archived: true` and a session exists for that thread:
- Send a PATCH to unarchive the thread (existing known approach)
- Do NOT delete the session
- Log the event

Current code deletes the session on archive, which causes the dropout symptom.

**FR-11: Auto-archive duration extended**

Default `auto_archive_duration` for ClaudeClaw-created threads: change from 4320 minutes (3 days) to 10080 minutes (7 days).

---

### P1 — Main Channel Behavior Control

**FR-12: Thread-only mode per channel**

Config option to put a channel into "thread-only" mode:
```json
"discord": {
  "threadOnlyChannels": ["1489787917709869058"]
}
```

In thread-only mode:
- Bot does NOT respond to messages in the main channel
- Bot ONLY responds when addressed in a thread
- Optionally: react with a 🧵 emoji to main channel messages to signal "use a thread"

This solves the chicken-and-egg problem where threads are preferred but the main channel pollutes context.

**FR-13: Configurable mention-only mode**

Config option per channel: only respond when directly @mentioned. Default off.

---

### P2 — Operational Improvements

**FR-14: Session summary on rotate**

When a session exceeds `maxMessages` or `maxAge`:
1. Run a summarization pass via Claude
2. Store summary to `session-summary-<id>.md`
3. Inject summary as context heading in new session
4. (Optionally) flush full transcript to Hindsight before rotating

**FR-15: `/status` shows all active sessions**

`/claudeclaw:status` should show:
- All active channel sessions (name, turn count, last used)
- All active thread sessions
- Active cron jobs
- Hindsight connection status (if enabled)

**FR-16: Discord channel → session label**

When a channel session is created, fetch the channel name from Discord API and store as `channelName` in session metadata. Use this in logs, status output, and Hindsight flush metadata.

**FR-17: Telegram parity**

Telegram should support:
- Per-chat session isolation (not just DM isolation modes — also per group chat)
- Hindsight flush on session end
- Voice memo → Hindsight path (same as FR-08)

---

### P3 — Nice to Have

**FR-18: Session card pinned on session start**

When a new channel or thread session is created, the bot sends a session card as its first message and immediately pins it via Discord API. This gives Morgan a persistent, always-visible link between the channel/thread and the underlying Claude session.

Card format:
```
📌 Session started
ID: cc-<short-id>
Channel: #channel-name (or thread title)
Started: 2026-05-13 20:40 UTC-5
```

Implementation notes:
- Send message first, capture returned `message_id`, then `PUT /channels/{id}/pins/{message_id}`
- Requires `Manage Messages` permission on the bot
- Should NOT re-pin if a session already exists for that context (i.e., on resume, update the existing pin rather than creating a new one, or skip if pin already present)
- On session clear (`/clear`), optionally unpin the old card so it doesn't accumulate
- Short ID: first 8 chars of the session UUID is sufficient for log correlation

**FR-19: `/sessions` command**

List all sessions (channel + thread) with IDs, channel names, turn counts. Optionally delete/clear specific ones.

**FR-20: Cron job channel binding**

Allow heartbeat/cron jobs to be bound to a specific channel session rather than the global session. Relevant for jobs that should not contaminate the main conversation context.

**FR-21: Plugin: ecomm automation hooks**

Webhook-compatible triggers from pass1/pass2 pipeline events → Claude sessions. Out of scope for ClaudeClaw core, but define the plugin interface so it can be built as an external plugin.

**FR-23: Web UI voice recorder**

Discord desktop (Mac/Windows) has no native voice message feature — it's mobile-only. Add a record button to the ClaudeClaw web UI as a desktop memo capture path.

Flow: Record button in UI → browser `MediaRecorder` API → capture audio → POST to ClaudeClaw `/memo` endpoint → Whisper transcription → Hindsight ingest (via FR-08 pipeline)

- Minimal UI: single button, status indicator (recording / processing / done)
- ClaudeClaw web server already exists; add a `/memo` POST endpoint
- Reuses the same Whisper + Hindsight path as FR-08/FR-08a
- No external services required

**FR-22: Attach existing Claude Code session to channel/thread**

Allow binding a pre-existing Claude CLI session to a Discord channel or thread by session ID.

Command: `/attach <session-id>` (in any thread or channel)

Behavior:
- Writes the provided session ID to that context's session store (same slot used by `getThreadSession` / channel sessions)
- All subsequent messages in that thread/channel run `claude --resume <provided-session-id>`
- Effectively bridges an active or prior CLI session into Discord

Use case: Morgan is working on a task in the terminal, wants to continue it from Discord without losing context.

Caveat: Claude CLI is single-writer — if the same session is actively running in a terminal simultaneously, messages from both surfaces will interleave in the same session. Best used for "bring this session here" handoff, not concurrent dual-surface operation.

**FR-24: Per-channel skill auto-loading**

Map Discord channel IDs to skills that auto-activate when a session starts in that channel. This ensures the right tools are available without needing to invoke them manually.

Config:
```json
"discord": {
  "channelSkills": {
    "1503968427516104854": ["coach"],
    "1506116212877430864": ["travel", "weather"]
  }
}
```

Behavior:
- When a new channel session starts (or resumes), ClaudeClaw reads `channelSkills[channelId]`
- Each named skill's description and invocation instructions are injected into the session's system prompt
- Skills are loaded from the standard skill resolution path (`~/.claude/skills/` or project-local `skills/`)
- If a skill is not found, log a warning and proceed — never block the session
- Thread sessions within a channel inherit the channel's skill bindings

Implementation notes:
- Skills injected at the top of the system prompt as a `<available_skills>` block, one per skill
- Skill content sourced by reading `{skillName}/skill.md` (or `{skillName}.md`) from the skill path
- Channel-level injection only — does not affect global sessions or other channels

---

## Implementation Sequence

| Priority | Feature | Complexity |
|----------|---------|------------|
| P0 | FR-05: thread_id fix | XS (done) |
| P0 | FR-01: per-channel sessions | M |
| P0 | FR-04: scoped /clear | S |
| P1 | FR-09: gateway watchdog | S |
| P1 | FR-10: thread archival recovery | S |
| P1 | FR-11: auto-archive 7d | XS |
| P1 | FR-06: Hindsight session flush | M |
| P1 | FR-07: Hindsight memory injection | M |
| P1 | FR-08: voice memo → Hindsight (memo channels + /memo command) | S |
| P1 | FR-08a: Whisper quality-based model routing | S |
| P1 | FR-12: thread-only mode | S |
| P2 | FR-14: session summary on rotate | M |
| P2 | FR-15: enhanced /status | S |
| P2 | FR-17: Telegram parity | M |
| P2 | FR-22: /attach session-id | S |
| P2 | FR-24: per-channel skill auto-loading | S |
| P3 | FR-18–FR-21, FR-23 | varies |

---

## Out of Scope (this fork)

- Slack integration (too much surface area for now)
- Multi-project coordination
- Web UI improvements
- Upstream PR (unless specific features are clearly reusable)

---

## Open Questions (Resolved)

1. **Hindsight memory injection timing** → Lazy (first query per session), not at session start.
2. **Per-channel session limit** → Max 5 concurrent channel sessions. If exceeded, respond with an alert to wait.
3. **nmemo as skill vs standalone** → Open to recommendation. *Lumen's take: build it as a ClaudeClaw skill — it already has the Whisper pipeline and Hindsight config wired in. Standalone adds deployment overhead for no gain.*

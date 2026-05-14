# ClaudeClaw Personal Fork Spec

## Summary
Personal fork of ClaudeClaw focused on two jobs: isolate separate Discord conversations so context does not bleed, and make Hindsight the durable capture/retrieval layer for voice memos and session recovery.

## Goals
- Keep multiple Discord channels and threads isolated from each other.
- Let Morgan resume work from Discord after being in the terminal, and vice versa.
- Capture Discord voice memos into Hindsight reliably.
- Support time-anchored retrieval of memos so past work can be rehydrated into an active session.

## Non-Goals
- Telegram parity.
- Confidence-based STT escalation.
- Public-upstream packaging or generalized multi-user hardening.
- Web UI voice recorder in MVP.

## Product Shape
This is a personal fork, so the spec optimizes for Morgan's daily workflow rather than broad compatibility.

The system has three primary surfaces:
- Discord conversation sessions
- Hindsight capture and recall
- Claude CLI session attachment/resume

## MVP Scope

### 1. Discord Session Isolation
- Each listened Discord channel gets its own Claude session.
- Each Discord thread keeps its own session.
- Channel sessions and thread sessions must not bleed context into each other.
- Discord threads always use the thread session even when the parent channel already has a channel session. Thread context wins.
- Existing global session behavior remains the fallback for unsupported or legacy cases. In MVP, Discord DMs stay on the legacy global fallback; non-Discord surfaces remain unchanged.
- Channel session cap is configurable, with a sane default of 5. A value of `0` means unlimited.
- If the cap is reached, new channel sessions are refused with a clear message; existing sessions may still resume.
- The user-facing cap message for a new channel session is: `⚠️ Session limit reached (<active>/<max>). Close or clear an existing session before starting a new one.`

#### Storage model
- `src/sessions.ts` currently manages the legacy global `session.json`.
- `src/sessionManager.ts` currently manages thread mappings in `sessions.json`.
- MVP extends `sessions.json` to hold all Discord-scoped mappings under a single file with this shape:

```json
{
  "global": {
    "sessionId": "uuid",
    "createdAt": "ISO8601",
    "lastUsedAt": "ISO8601",
    "turnCount": 0,
    "compactWarned": false
  },
  "channels": {
    "<channelId>": {
      "sessionId": "uuid",
      "createdAt": "ISO8601",
      "lastUsedAt": "ISO8601",
      "turnCount": 0,
      "compactWarned": false,
      "channelName": "string",
      "label": "string"
    }
  },
  "threads": {
    "<threadId>": {
      "sessionId": "uuid",
      "threadId": "<threadId>",
      "parentChannelId": "<channelId>",
      "createdAt": "ISO8601",
      "lastUsedAt": "ISO8601",
      "turnCount": 0,
      "compactWarned": false,
      "channelName": "string"
    }
  }
}
```

- Existing `session.json` remains the legacy/global fallback store for backward compatibility.
- Existing `sessions.json` thread entries are preserved in place and extended; legacy global sessions are not auto-promoted into channels.
- If channel name lookup fails, session creation still succeeds and stores the raw channel id with an empty `channelName`.

### 2. Scoped Session Control
- Discord command surface must align to the current slash-command model in `src/commands/discord.ts`. MVP uses `/reset`, `/compact`, `/status`, and a new `/attach` slash command rather than `'/claudeclaw:*'` command strings.
- `/reset` clears only the current context's session.
- `/reset` must flush the scoped session to Hindsight before removing it.
- `/compact` is scoped to the current context.
- Clearing or compacting one context must not affect other channel/thread sessions.
- Running `/reset` or `/compact` in a context with no active session is a no-op with a confirmation message instead of an error.
- `--all` clears every session. It must iterate sessions sequentially, attempt Hindsight flush for each, continue on failure, and return a final summary of flush successes, flush failures, and clear successes.
- `--all` work may execute asynchronously behind the command response, but it must process the target sessions in deterministic sequential order.
- Fallback sessions used for rate-limit recovery are included in `--all` clearing.

### 3. Hindsight Flush + Recall
- Session-ending events that should flush to Hindsight in MVP:
  - scoped `/reset`
  - `--all`
  - scoped `/compact`
  - attach replacement
- Auto-rotation for channel sessions is deferred. Current `src/runner.ts` global-only rotation behavior remains in place for MVP; channel sessions do not gain new auto-rotation behavior in this pass.
- Flush payloads must include enough metadata to support later rehydration:
  - timestamp
  - source surface
  - channel id / thread id
  - channel name when available
  - session id
  - author metadata when relevant
  - transcript or message content
  - document id for idempotent upsert behavior when appropriate
- The implementation should use the real Hindsight HTTP API / client contract already referenced in `refs/hindsight`:
  - retain: `POST /v1/default/banks/{bank_id}/memories`
  - recall: `POST /v1/default/banks/{bank_id}/memories/recall`
  - auth: optional `Authorization: Bearer <token>`
- Retain requests must send `items` and may set `async: true` for non-blocking flush behavior. Each item should include `content`, optional `context`, optional `document_id`, optional `timestamp`, optional `metadata`, and optional `tags` where available.
- Recall requests must send `query` and may send `budget`, `max_tokens`, `query_timestamp`, `types`, and tag filters.
- First substantive message in a session triggers a Hindsight recall lookup.
- A message is substantive when it is not empty after mention stripping, is not only emoji/noise, is not a control command, or contains a non-trivial voice transcript.
- Recall query should use current message text, channel name, and recent local transcript/snippet context. If the user provides an explicit time reference, the implementation should set `query_timestamp` when building the recall request.
- Recalled memories are injected into the Claude context as a single bounded `<hindsight_memories>` block.
- Recall bounds for MVP: maximum 5 recalled items and maximum 4,000 characters total after formatting.
- The injected block must warn that recalled memories may be incomplete or stale.
- If recall returns excessive or malformed content, the implementation discards it and logs the event rather than injecting it.
- Recall must never block the session if Hindsight is unavailable. On timeout or failure, ClaudeClaw logs the error and proceeds without memory injection.
- Flush timeout or failure must not block session clear or attach replacement. If flush fails, the session mapping may still be removed as long as the local session transcript remains on disk for later manual ingestion.

### 4. Discord Memo Channels
- Configured memo channels ingest text or voice directly into Hindsight.
- Memo channels do not start a Claude conversation.
- Success is acknowledged with a ✅ reaction.
- Failures should be visible in-channel and logged.
- Voice memos use the existing transcription pipeline, then ingest the transcript to Hindsight.
- Memo-channel authorization follows the existing Discord authorization rules; unauthorized users are rejected visibly.
- Memo payload rules for MVP:
  - text only → ingest raw text
  - voice only → ingest transcript
  - voice + text → ingest transcript plus user text together
  - multiple voice attachments → reject with a visible error
  - plain text attachments may be ingested as additional text context
  - non-text, non-voice attachments are ignored in MVP
- Voice transcription retries up to 3 times before reporting a visible error.

### 5. Attach Existing Session
- `/attach <session-id>` binds a Discord channel, thread, or DM to an existing Claude session.
- Attaching replaces the current binding for that context.
- If an existing binding is replaced, ClaudeClaw attempts a Hindsight flush before overwriting the old binding. Flush failure is logged but does not block replacement.
- Blind attach is allowed; the session does not need to be locally known at command time.
- Subsequent messages in that context resume the attached session.
- If resume of the attached session fails because the session is stale or missing, ClaudeClaw must present Morgan with an explicit choice to either stop or start a new session for that context. It must not silently create a new session.

## V2 Scope
- Gateway watchdog reconnect.
- Thread archival recovery.
- `/memo` command or prefix outside memo channels.
- Web UI voice recorder.

## Deferred
- Telegram parity.
- Whisper confidence fallback / remote STT escalation.

## Behavioral Rules
- Time-anchored recall should work as a rehydration tool, not just a semantic search tool.
- Memo ingestion must preserve enough metadata to answer queries like: "what was I working on last Wednesday around 4:45?"
- Recall should favor recent, relevant memo captures when the user is trying to resume a task.
- Hindsight integration should remain invisible during normal chat flow unless it is actively needed.

## Relevant Existing Code
- `src/commands/discord.ts`
  - owns Discord gateway handling, message routing, attachments, and slash command registration
  - currently registers `/reset`, `/compact`, `/status`, and related commands
  - `DiscordMessage` currently lacks `thread_id`, so thread reply routing must be formalized here
- `src/sessionManager.ts`
  - currently persists thread sessions in `.claude/claudeclaw/sessions.json`
  - must be extended to support channel sessions and richer metadata
- `src/sessions.ts`
  - currently persists the legacy global session in `.claude/claudeclaw/session.json`
  - remains the fallback path for Discord DMs and non-Discord surfaces in MVP
- `src/runner.ts`
  - currently resumes sessions via `--resume` and already contains stale-session recovery logic
  - currently rotates only the global session, not thread or channel sessions
- `src/whisper.ts`
  - current local transcription path used for Discord voice ingestion

## Edge Cases & Failure Modes
- If a new listened channel receives its first message when the channel cap is reached, ClaudeClaw replies with the configured cap warning and does not spawn a new Claude process.
- If Hindsight recall returns malformed, oversized, or unusable content, ClaudeClaw discards it and logs the failure.
- If Hindsight ingest fails during scoped clear, attach replacement, or `--all`, ClaudeClaw logs the failure and continues the local clear/replace path.
- If a channel or thread has no active session and the user runs `/reset` or `/compact`, ClaudeClaw returns a no-op confirmation instead of an error.
- If channel-name lookup fails, session creation still succeeds with empty `channelName`.
- If a thread is active under a parent channel session, the thread session always handles that message.
- If a memo channel message arrives from an unauthorized user, ClaudeClaw rejects it visibly and does not ingest it.
- If voice transcription fails, ClaudeClaw retries up to 3 times and then posts a visible error.
- `--all` runs sequentially per session but may be launched as an asynchronous job from the command path to avoid blocking the user-facing response.
- Existing `session.json` and existing `sessions.json` thread entries are preserved during migration. No automatic promotion of the global session into a channel mapping occurs.

## Acceptance Criteria
- **Channel isolation**
  - Given two listened Discord channels with separate active sessions, when Morgan asks unrelated follow-up questions in each channel, then each reply must reflect only that channel's prior context and must not reference the other channel's work unless Morgan restates it.
- **Thread precedence**
  - Given a parent channel with an active channel session and a child thread with an active thread session, when Morgan posts in the thread, then ClaudeClaw must resume the thread session and must not resume the parent channel session.
- **Scoped reset**
  - Given an active channel or thread session, when Morgan runs `/reset` in that context, then ClaudeClaw must attempt Hindsight flush for that context, clear only that context's session mapping, and leave every other session untouched.
- **Scoped reset no-op**
  - Given a context with no active session, when Morgan runs `/reset`, then ClaudeClaw must return a confirmation that there was no active session to clear and must not error.
- **`--all` behavior**
  - Given multiple active sessions, when Morgan runs `/reset --all`, then ClaudeClaw must process sessions sequentially, continue past flush failures, clear all targeted session mappings, and return a summary of successes and failures.
- **Cap enforcement**
  - Given the configured channel cap has been reached, when Morgan sends a first message in a new listened channel, then ClaudeClaw must refuse to create a new channel session, must not start a new Claude process for that channel, and must return the cap warning message.
- **Recall injection**
  - Given a brand-new channel session and a substantive first message, when Hindsight returns relevant memories, then ClaudeClaw must inject at most 5 items and at most 4,000 characters inside a single `<hindsight_memories>` block before resuming Claude.
- **Recall failure handling**
  - Given Hindsight is unavailable or returns malformed output, when the first substantive message arrives, then ClaudeClaw must log the problem, skip memory injection, and still continue the conversation.
- **Memo channel voice ingest**
  - Given a memo channel and a Discord mobile voice message from an authorized user, when transcription succeeds, then ClaudeClaw must ingest the transcript to Hindsight, must not start a Claude conversation, and must react with ✅.
- **Memo transcription failure**
  - Given a memo channel voice message, when transcription fails 3 times, then ClaudeClaw must post a visible failure message and must not silently swallow the error.
- **Memo payload composition**
  - Given a memo channel message containing both voice and text, when the message is ingested, then the retained content must contain both the transcript and the user text in one memory item or document batch tied to the same event.
- **Attach success**
  - Given a valid existing Claude session id, when Morgan runs `/attach <session-id>` in a channel, thread, or DM, then subsequent messages in that context must use `claude --resume <session-id>`.
- **Attach replacement flush**
  - Given a context already bound to a session, when Morgan attaches a different session id, then ClaudeClaw must attempt Hindsight flush on the old binding before overwriting it.
- **Attach stale-session choice**
  - Given an attached session id that no longer exists in Claude, when the next message attempts resume and stale-session recovery is triggered, then ClaudeClaw must prompt Morgan to either stop or create a fresh session instead of silently replacing the binding.
- **Migration safety**
  - Given an existing install with `session.json` and `sessions.json`, when the new channel-session feature is enabled, then existing global fallback and existing thread sessions must remain readable and no global session may be auto-promoted into a channel entry.

## Open Questions & Deferred Decisions
- Channel auto-rotation is explicitly deferred beyond MVP.
- Telegram parity is explicitly deferred.
- Confidence-based STT fallback is explicitly deferred.

## Notes
- This spec intentionally separates fork-only workflow from any future upstreamable cleanup.
- Reliability fixes can be spec'd and shipped later without blocking the core isolation + memory workflow.

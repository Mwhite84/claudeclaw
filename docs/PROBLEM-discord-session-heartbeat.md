# Problem: Discord Session Drops During Long-Running Agent Turns

**Status:** Open — needs design + implementation  
**Logged:** 2026-05-15  
**Discovered via:** Lumen running multi-minute background tasks (Opus memo generation, pipeline jobs) and Discord connection going stale

---

## Problem Statement

When ClaudeClaw is running a long background task — an Opus agent generating memos, a multi-step pipeline job, anything that takes 3–10+ minutes — the Discord gateway session drops because there is no interaction on the connection while the agent is working. From the user's perspective, the session goes silent and Discord appears disconnected or unresponsive.

This is distinct from the pipeline jobs themselves timing out. The jobs continue running. The issue is that the **Claude Code ↔ Discord session** loses its heartbeat context, and the user has no visibility into what's happening. When the work completes, the reply either fails to deliver or arrives in a broken session state.

---

## Symptoms

- Discord session shows as disconnected or stops receiving messages during long agent runs
- User has no progress visibility while background work is in progress
- Reply delivery is unreliable after session drops (message may go to dead thread, wrong state, or silently fail)
- INVALID_SESSION errors observed after long idle periods (also seen after cron job runs)
- User must manually restart the session or reconnect to continue

---

## Root Cause

ClaudeClaw processes Discord turns synchronously within the listener lifetime. When an agent turn is long (e.g. Opus doing deep research, file I/O, spawning sub-agents), the listener is tied to that turn's execution. If the turn exceeds Discord's gateway interaction budget or the bot doesn't send keepalive signals during processing, the session degrades.

The OpenClaw (Slack) implementation avoids this by periodically updating the Slack thread message with status — this keeps the Slack session alive AND gives the user a progress indicator. ClaudeClaw has no equivalent mechanism.

---

## What OpenClaw Does (Reference)

In the Slack channel implementation, OpenClaw:
1. Accepts the inbound event quickly and queues the work
2. Posts an initial "Working..." message to the thread
3. Periodically updates that message with status as the agent progresses
4. Replaces the message with the final reply on completion

This decouples the listener lifetime from the agent execution time.

There is also a documented async inbound worker plan (`Discord Async Inbound Worker Plan`) that describes making Discord turns fully async: gateway listener accepts and normalizes quickly, a run queue stores jobs, a worker executes outside the listener lifetime, and replies are delivered back after completion.

---

## Desired Behavior

1. **Session stays alive** during long agent runs — no dropped connections
2. **User sees progress** — at minimum, a "working..." indicator; ideally periodic status updates
3. **Reply delivery is reliable** — response goes to the right thread/channel when work completes
4. **No user action required** — they shouldn't need to restart or reconnect

---

## Proposed Solutions

### Option A: Async Inbound Worker (Correct Long-Term Fix)
Implement the async worker pattern already documented in the OpenClaw plan:
- Listener accepts event and immediately queues job (fast path, no timeout risk)
- Worker processes job outside listener lifetime
- Reply delivered to originating channel/thread on completion
- Status updates posted at agent checkpoints or on a timer

This is the architecturally correct fix but requires meaningful refactoring of how Discord turns are processed.

### Option B: Heartbeat + Periodic Status Edit (Pragmatic Short-Term Fix)
Without restructuring the turn lifecycle:
- When a turn starts, post an initial "⏳ Working..." message to the thread
- Set up a background interval that edits that message every 60–90s with elapsed time or last known status
- On completion, replace with the actual response
- Cancel the interval on error or completion

Less architecturally clean but can be implemented without touching the turn queue or session management.

### Option C: Progress Webhook in Agent Runs
For background agents specifically (Opus tasks, etc.):
- Pass a Discord webhook URL / channel ID as context to the spawned agent
- Have the agent POST progress updates at natural checkpoints
- Main session stays idle but user still gets updates

Requires agents to be progress-aware. Fragile — not all agent types support this cleanly.

---

## Recommendation

Short term: **Option B** — add a working indicator with periodic edit. Low risk, immediate UX improvement, buys time for the proper fix.

Long term: **Option A** — the async worker pattern. Matches how OpenClaw handles Slack, eliminates the session lifetime coupling entirely.

---

## Related

- `MULTI_SESSION_SPEC.md` — session isolation design
- `RESTART_RESUME_SPEC.md` — session recovery behavior
- OpenClaw Slack channel implementation (reference for Option A pattern)
- INVALID_SESSION bug from cron job runs (related but separate — session resumable=false after cron completes)

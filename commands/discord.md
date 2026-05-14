---
description: Show Discord bot status and manage sessions
---

Show the Discord bot integration status. Check the following:

1. **Configuration**: Read `.claude/claudeclaw/settings.json` and check if `discord.token` is set (show masked token: first 5 chars + "..."). Show `allowedUserIds`, `listenChannels`, `listenGuilds`, `memoChannels`, and `maxChannelSessions`.

2. **Sessions**: Discord sessions are isolated by context:
   - **Channel sessions**: Each listened Discord channel gets its own Claude session, stored in `.claude/claudeclaw/sessions.json` under `channels`.
   - **Thread sessions**: Each Discord thread gets its own session, stored under `threads`.
   - **Global fallback**: Discord DMs use the legacy global session in `session.json`.

3. **Slash Commands**: The following slash commands are registered:
   - `/start` — Show welcome message and usage instructions
   - `/reset` — Reset the session for the current context (thread, channel, or global)
   - `/reset all` — Reset ALL sessions across all contexts, with Hindsight flush
   - `/compact` — Compact the current context's session to reduce context size
   - `/status` — Show current session status including active channel/thread sessions
   - `/context` — Show context window usage for the current session
   - `/attach <session-id>` — Attach the current context to an existing Claude session by UUID

4. **Hindsight Integration**: If `hindsight.baseUrl` and `hindsight.bankId` are configured:
   - First substantive message in a new channel/thread session triggers a Hindsight recall, injected as a `<hindsight_memories>` block into Claude's context.
   - Session-ending events (reset, compact, attach replacement) flush transcripts to Hindsight.
   - Flush failures are logged but never block session operations.

5. **Memo Channels**: Channels listed in `discord.memoChannels` ingest messages directly to Hindsight instead of starting Claude conversations:
   - Text only → ingest raw text
   - Voice only → ingest transcript (up to 3 transcription retries)
   - Voice + text → ingest both together
   - Success is acknowledged with a ✅ reaction; no Claude reply.

6. **Channel Session Cap**: `maxChannelSessions` (default: 5) limits concurrent channel sessions. `0` means unlimited. When the cap is reached, new channel sessions are refused with a warning.

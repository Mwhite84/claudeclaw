# ClaudeClaw Enhancements Backlog

Future improvements to implement when there's capacity.

## Discord

### Reaction visibility
Handle `MESSAGE_REACTION_ADD` / `MESSAGE_REACTION_REMOVE` Gateway events so the bot can see when users react to messages. The intents already include `GUILD_MESSAGE_REACTIONS` (bit 10) so events are being delivered — just need a handler. Could be used for lightweight acknowledgment (e.g., ✅ reaction = confirm, ❌ = cancel) or just logging context.

**Requested:** 2026-05-18 by Morgan

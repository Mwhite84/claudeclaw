---
description: Work through an epic's ready queue
agent: omg-build
then: /omg-ensure-work-finished
---

Work through the ready queue for epic `$1`.

Before starting, load the `omg-commands` skill. If you need to manage
epic-level operations or dependencies, also load the `omg-epics` skill.

Your workflow:
1. Run: `bd ready --parent $1 --unassigned --json --limit 1`
2. If no results, the epic is complete. Run: `bd epic close-eligible && bd dolt commit`
3. Claim the issue: `bd update <id> --claim`
4. Read the full description: `bd show <id>`
5. Implement what the description says.
6. If you discover new work while implementing, file it immediately.
   Refer to the "Filing Discovered Work" section in the `omg-commands` skill
   for the command format, type/priority guidance, and how to handle
   discovered work within epics.
7. When done: `bd close <id> --reason "what you did" --json`
8. Go back to step 1.

IMPORTANT: If the bead you reach is a code review bead, invoke the reviewer:
`@omg-reviewer`
Pass it the epic ID and the review bead ID so it knows what to review and what
to close.

All work creates beads. Everything you do must be tracked in beads.
Do NOT use TodoWrite or markdown TODO lists.

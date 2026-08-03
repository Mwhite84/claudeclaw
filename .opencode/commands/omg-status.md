---
description: Show current beads state
subtask: true
---

Show the current beads state:

1. Ready work: `bd ready --json`
2. In progress: `bd list --status in_progress --json`
3. Blocked: `bd blocked --json`
4. Recent: `bd list --limit 10 --json`

Summarize the state concisely. Do not dump raw JSON — parse it and present
a human-readable summary with counts, priorities, and any notable blockers.

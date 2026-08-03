---
description: Run beads maintenance (cleanup, doctor, commit)
subtask: true
---

Run beads maintenance:
1. `bd cleanup --days 7`
2. `bd doctor --fix`
3. `bd dolt commit`

Report what was cleaned up and any issues doctor found.

---
name: omg-commands
description: Detailed beads CLI command reference for creating, updating, and managing issues. Load this skill before creating issues, filing discovered work, or updating issue fields.
---

# Beads Command Reference

## Creating Issues

```
bd create "Title" -d "description" --type task --priority 2 --json
```

- Use `--body-file=<path>` for long descriptions (up to 64 KB)
- Use `-d "markdown content"` for inline descriptions
- Use `--spec-id "<spec-path>"` to link an epic to its spec file
- Use `--parent <epic-id>` to create a child under an epic
- 4 rich-text fields: description (`-d`), design (`--design`),
  acceptance criteria (`--acceptance`), notes (`--notes`)
- Priority: 0-4 or P0-P4 (0=critical, 2=medium, 4=backlog).
  NOT "high"/"medium"/"low"
- Types: `task`, `bug`, `feature`, `epic`, `chore`, `decision`
  - `task` — default; discrete unit of work (implementation, research, setup)
  - `bug` — defect or regression in existing behavior
  - `feature` — new user-facing capability
  - `epic` — container for child beads; not directly implementable
  - `chore` — maintenance, refactoring, or infrastructure with no user-visible change
  - `decision` — architectural or design decision to record (aliases: `dec`, `adr`)

## Updating Issues

```
bd update <id> --title "..." --description "..." --notes "..."
bd update <id> --status in_progress
bd update <id> --assignee username
bd update <id> --body-file=<path>            # Sync body from file content
```

**WARNING**: Do NOT use `bd edit` — it opens $EDITOR which blocks agents.
Always use `bd update` with inline flags instead.

## Claiming and Closing

```
bd update <id> --claim                 # Atomic: sets assignee + in_progress
bd close <id> --reason "what you did"  # Complete work
bd close <id1> <id2> ...               # Close multiple at once (more efficient)
```

## Finding Work

```
bd ready --json                        # Unblocked work
bd ready --parent <epic> --json        # Scoped to an epic
bd show <id> --json                    # Full issue details
bd list --status open --json           # All open issues
bd list --spec "<spec-path>" --json    # Find epic by spec file path
bd blocked --json                      # Show all blocked issues
```

## Filing Discovered Work

When you find something that needs attention while working on another task,
file it immediately. Always set the type and priority explicitly based on
what you discovered:

```
bd create "Found issue" -d "Details" --type bug --priority 1 --deps discovered-from:<current-bead-id> --json
```

This creates the new issue and links it back to the bead where it was discovered.
Adjust `--type` and `--priority` to match the nature and urgency of the issue.

### Discovered Work Within Epics

When you discover work while executing an epic and the issue is important to
the success of that epic:

1. Create it as a child of the epic with `--parent <epic-id>`.
2. Add a dependency from the review bead to the new bead so the review
   cannot close until the new work is done:
   `bd dep add <review-bead-id> <new-bead-id>`

If you discover the issue **while executing the review bead**:

1. Create the child bead and wire the dependency as above.
2. Stop the review immediately — the review bead is now blocked by the
   new bead and cannot be closed anyway.
3. Set the review bead back to open: `bd update <review-bead-id> --status open`
4. Work the new bead to unblock the review.
5. When the review bead appears in the ready queue again, restart the
   review from scratch.

## Sync

```
bd dolt commit                         # Commit pending beads changes
bd dolt push                           # Push to Dolt remote (if configured)
```

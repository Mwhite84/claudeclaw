---
name: omg-epics
description: Epic decomposition, dependency wiring, and DAG validation for beads. Load this skill when creating epics, wiring dependencies between issues, or validating epic structure.
---

# Epics and Dependencies

## Core Concepts

- Epics contain child beads. Children are **parallel by default**.
- Only add blocking deps where ordering truly matters
  (e.g., schema before queries, types before implementations).
- Do NOT over-constrain — unnecessary deps reduce parallelism.

## Dependency Commands

```
bd dep add <dependent> <dependency>    # "dependent" is blocked by "dependency"
bd dep tree <epic-id>                  # Visual dependency graph
bd swarm validate <epic-id>            # Validate DAG structure (no cycles)
bd blocked --json                      # Show all blocked issues
```

The argument order matters: `bd dep add A B` means "A depends on B" (B blocks A).

## Epic Lifecycle

```
bd create "<Feature>" -t epic -p 1 --spec-id "<spec-path>" --body-file=<spec-path> --json  # Create epic linked to spec
bd list --spec "<spec-path>" --json                                   # Find epic by spec file path
bd update <epic-id> --body-file=<spec-path>                           # Sync epic body from spec
bd ready --parent <epic-id> --json                                    # Find ready children
bd mol progress <epic-id>                                             # Completion %, rate, ETA
bd epic close-eligible                                                # Close epics where all children done
```

## Review Bead Pattern

Every epic should have a final "Code review" bead:
- Blocked by ALL other child beads (so it's reached last)
- Description tells the agent to invoke `@omg-reviewer`
- The reviewer files findings as beads with `discovered-from` links
- Close the review bead only when the review is complete

## Validation Checklist

After wiring dependencies, always:
1. `bd swarm validate <epic-id>` — check for cycles and structural issues
2. `bd dep tree <epic-id>` — visually confirm the dependency graph looks right

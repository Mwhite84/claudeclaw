# Beads Workflow

Use the `bd` CLI for ALL task tracking. Run bd commands via the bash tool —
there is no native bd tool.

## Core Rules

- Use beads for ALL tracking. No TodoWrite, no markdown TODOs. No exceptions.
- Create the bead BEFORE writing code.
- Use `--json` for structured output when parsing results.
- Do NOT use `bd edit` — it opens $EDITOR and blocks agents.
  Use `bd update` instead.

## Skills

Detailed command reference and epic management instructions are available as
skills. Load them on demand to avoid context bloat:

- **omg-commands** — issue creation, field updates, discovered work patterns
- **omg-epics** — epic decomposition, dependency wiring, DAG validation

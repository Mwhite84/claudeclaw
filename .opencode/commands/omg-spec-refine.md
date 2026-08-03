---
description: Run a refinement pass on a specification to tighten it for decomposition
agent: omg-spec-writer
---

Run one refinement pass on the specification at: $1

Read the spec thoroughly, then work through these checks:

1. **Gaps** — Are there requirements that are too vague for a coding agent to
   implement without asking questions? Identify them and ask me to clarify.
2. **Contradictions** — Do any requirements conflict with each other? Flag them.
3. **Missing edge cases** — What failure modes, error states, or boundary
   conditions are not addressed?
4. **Acceptance criteria** — Is every requirement paired with a way to verify it?
   Add criteria where missing.
5. **Open questions** — Are there unresolved items? Push me to resolve them or
   explicitly defer them.

After the review, update the spec file with any agreed changes. Do not rewrite
sections that are already solid.

Once the spec file is updated, sync the epic body to match:
1. Find the epic: `bd list --spec "$1" --json`
2. Update the epic body: `bd update <epic-id> --body-file=$1`

This command can be run multiple times. Each pass should make the spec tighter
and closer to decomposition-ready. When you believe the spec is ready, say so
and suggest running `/omg-decompose $1`.

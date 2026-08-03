---
description: Decompose a spec into child tasks under its epic with dependencies
agent: omg-decomposer
---

Decompose the specification at `$1` into child tasks under an epic.

Steps:

1. Read the spec file at `$1` thoroughly.

2. Find the existing epic for this spec:
   ```
   bd list --spec "$1" --json
   ```
   If no epic exists, ask me whether I want to create one. If I confirm:
   ```
   bd create "<Feature>" -t epic -p 1 --spec-id "$1" --body-file=$1 --json
   ```

3. Sync the epic body to match the current spec file content:
   ```
   bd update <epic-id> --body-file=$1
   ```

4. Ensure the spec file and beads state are committed before proceeding.
   The spec file will be deleted at the end, so uncommitted changes would
   be lost:
    ```
    bd dolt commit
    git add $1 .beads/
    git status
    ```
   If there are uncommitted changes, commit them now:
   ```
   git commit -S -m "Sync spec and beads state before decomposition"
   ```

5. Create child tasks under the epic with rich markdown descriptions:
   ```
   bd create "<Task title>" -t task --parent <epic-id> -d "..." --json
   ```
   Use `--body-file` for long descriptions or `-d` with full markdown for
   shorter ones.

6. Wire blocking dependencies between children:
   ```
   bd dep add <dependent-child> <dependency-child>
   ```

7. Create a final "Code review" bead as a child of the epic:
   ```
   bd create "Code review: <feature>" -t task --parent <epic-id> --json
   ```
   - Blocked by ALL other child beads
   - Description:
     ```
     Invoke the reviewer agent (@omg-reviewer) to perform a thorough code
     review of all changes in this epic. The reviewer will file beads for
     every finding using discovered-from links. Close this bead only when the
     review is complete.
     ```

8. Validate the dependency graph: `bd swarm validate <epic-id>`

9. Show the structure: `bd dep tree <epic-id>`

10. Run 4 refinement passes:
    - Pass 1: Description completeness — can an agent implement each bead
      without asking questions? If not, add the missing context.
    - Pass 2: Dependency correctness — missing ordering constraints?
      Unnecessary ones blocking parallelism? Fix them.
    - Pass 3: Scope sizing — split anything too large, merge anything too
      small.
    - Pass 4: Final polish — proofread titles, descriptions, acceptance
      criteria. Ensure the review bead blocks on everything.

11. Present the final structure for my review.

12. After I confirm the structure, remove the spec file:
    ```
    git rm $1
    ```
    The spec content is preserved in the epic body and in git history.

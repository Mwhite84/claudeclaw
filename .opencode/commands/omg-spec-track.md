---
description: Create a tracking epic for an existing specification
agent: omg-spec-writer
---

Track the specification at: $1

Read the spec file and create an epic to track it:

1. Read the file to understand what it covers.
2. Create an epic with the spec content as the body:
   ```
   bd create "Spec: <concise feature name>" -t epic --spec-id "$1" --body-file=$1 --json
   ```
3. Tell me the epic ID and suggest next steps:
   - `/omg-spec-refine $1` to tighten the spec
   - `/omg-decompose $1` to break it into work items

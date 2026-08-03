---
description: Create a specification through interactive dialogue
agent: omg-spec-writer
---

I want to create a specification for: $ARGUMENTS

Start by asking me clarifying questions to understand what I'm trying to build.
Do not start writing the spec until you have a clear picture. Push back on
anything vague — I need you to help me think through this thoroughly.

Once you understand the requirements:
1. Write the spec to a markdown file in the !`yq -r '.specs.directory // "specs"' .workflow.yaml 2>/dev/null || echo specs` directory.
   Use a slugified version of the topic as the filename (e.g., `user-auth.md`).
   Create the directory if it doesn't exist.
2. Create an epic to track the spec:
   ```
   bd create "Spec: <feature>" -t epic --spec-id "<spec-path>" --body-file=<spec-path> --json
   ```
3. Tell me the epic ID and suggest next steps:
   - `/omg-spec-refine <spec-path>` to tighten the spec
   - `/omg-decompose <spec-path>` when I'm ready to break it into work items

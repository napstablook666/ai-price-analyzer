---
name: trellis-meta
description: "Understand and customize Trellis Lite project files: workflow, platform context loading, skills, commands, PRDs, specs, tasks, journals, and explicitly invoked Channel or memory tools."
---

# Trellis Lite Meta

Trellis Lite provides shared project knowledge and PRD planning across every supported platform. The current main session researches, implements, and chooses appropriate validation tools.

## Find the owner

- Workflow: `.trellis/workflow.md`; status blocks supply per-turn context on capable platforms.
- Requirements: `.trellis/tasks/<task>/prd.md`; optional design, execution notes, and research live beside it.
- Conventions: `.trellis/spec/`; use `get_context.py --mode packages` to discover relevant indexes.
- Memory: `.trellis/workspace/<developer>/journal-*.md`; `trellis mem` searches local host conversation history.
- Platform integration: commands, skills, startup hooks/plugins/extensions, settings, and session identity propagation.
- Task runtime: `.trellis/.runtime/sessions/`; do not share another session's active-task pointer.
- Channel: independent collaboration CLI, used when the user explicitly requests it. Supply explicit prompts/context for workers.

## Customize

Read the relevant local file before changing it. Keep platform entrypoints consistent with the shared workflow. Preserve user content and existing task data. `trellis update` manages generated files by hashes; locally modified files need deliberate conflict handling.

Useful references:

- [Workflow](references/local-architecture/workflow.md)
- [Task system](references/local-architecture/task-system.md)
- [Spec system](references/local-architecture/spec-system.md)
- [Context loading](references/local-architecture/context-injection.md)
- [Platform map](references/platform-files/platform-map.md)
- [Hooks and settings](references/platform-files/hooks-and-settings.md)
- [Change workflow](references/customize-local/change-workflow.md)
- [Change context loading](references/customize-local/change-context-loading.md)

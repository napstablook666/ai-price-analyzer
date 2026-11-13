# Local Workflow System

Trellis Lite uses one main-session workflow on all supported platforms:

1. Discuss requirements and persist the agreed goal, scope, constraints, and acceptance criteria in the task's `prd.md`.
2. Load relevant specs and supporting task documents, then implement directly in the current session.
3. Choose validation tools appropriate to the task, capture useful knowledge, and record progress/outcomes.

The canonical workflow is `.trellis/workflow.md`. Specs live under `.trellis/spec/`, tasks under `.trellis/tasks/`, and journals under `.trellis/workspace/`. Platform-specific commands, skills, startup hooks, plugins, or extensions load these shared files. Preserve each platform's session identity propagation when customizing context loading.

Additional design/research documents are optional. Historical task data is preserved on upgrade. Explicitly requested Channel workers use user-provided prompts and context; they are independent of the default development workflow.

# Trellis Lite Development Workflow

## Core Principles

1. Discuss requirements and persist the agreed outcome in `prd.md` before substantial implementation.
2. The current main session researches, implements, and chooses appropriate validation tools.
3. Load relevant project specs on demand. Preserve decisions and progress in project files so another tool can continue.
4. Keep task management and session journals lightweight.

## Trellis System

### Developer Identity

```bash
python ./.trellis/scripts/init_developer.py <your-name>
```

Creates `.trellis/.developer` and `.trellis/workspace/<your-name>/`.

### Spec System

Project conventions live in `.trellis/spec/`. Discover available packages/layers, read the relevant indexes, then follow their links when needed:

```bash
python ./.trellis/scripts/get_context.py --mode packages
```

### Task System

A task directory contains `task.json` and `prd.md`. Add `design.md`, `implement.md`, or `research/` when the work benefits from them. Task context lives in these documents and relevant specs.

```bash
python ./.trellis/scripts/task.py create "<title>" --description "<goal>" --slug <name>
python ./.trellis/scripts/task.py start <name>
python ./.trellis/scripts/task.py current --source
python ./.trellis/scripts/task.py finish
python ./.trellis/scripts/task.py archive <name>
python ./.trellis/scripts/task.py list
```

Task creation records `planning`; start changes it to `in_progress`; archive records `completed` and moves the task into the archive. Active task pointers are session-scoped where session identity is available. Without session identity, read the task path from the conversation and pass it explicitly to task commands.

When switching coding tools, load the same task's PRD, decisions, progress, and relevant specs. Activate it in the new session with `task.py start`.

### Workspace System

Session journals live in `.trellis/workspace/<developer>/`. Record meaningful progress and handoff information:

```bash
python ./.trellis/scripts/add_session.py --title "Session title" --summary "Outcome and next steps"
```

## Phase Index

Phase 1: Plan -> discuss requirements and write the PRD.
Phase 2: Execute -> implement directly in the main session.
Phase 3: Finish -> capture useful knowledge and record the outcome.

### Request Triage

Questions and contained edits may be handled directly. For substantial work, use a task and the requirements discussion flow. Existing user instructions and approvals remain authoritative; do not repeatedly request an approval already given.

### Active Task Routing

- Planning: discuss requirements with `trellis-brainstorm` and update the PRD.
- In progress: read the PRD and specs, then implement directly in the main session.
- Completed: capture useful knowledge and use `finish-work` to record the outcome.

### Parent / Child Task Trees

Use a parent for a shared goal and children for independently resumable work. Keep common requirements in the parent PRD and each child's scope and progress in its own PRD. Prefer a single task unless separate tracking helps. Activate the task being implemented and preserve its parent/child links across tools.

### Planning Artifacts

- `prd.md`: goal, scope, constraints, and acceptance criteria; update it as requirements converge.
- `design.md`, `implement.md`, and `research/`: optional supporting material when useful.

### Phase 1: Plan

- 1.0 Create or resume the task.
- 1.1 Discuss requirements and generate/update the PRD.
- 1.2 Research open questions in the main session as needed.
- 1.4 Activate the task when requirements are clear and implementation is authorized.

[workflow-state:no_task]
Classify the request. For substantial work, create or resume a task and use `trellis-brainstorm` to discuss requirements and write `prd.md`. Respect approvals already given in this conversation.
[/workflow-state:no_task]

[workflow-state:task_error]
The active task record could not be read. Do not create or activate another task to hide this error. Inspect and repair its task.json into a valid JSON object with a non-empty status, preserving existing task data.
[/workflow-state:task_error]

[workflow-state:planning]
Use `trellis-brainstorm` to clarify requirements and update `prd.md`. Research directly in this session. When requirements are clear and implementation is authorized, run `task.py start`.
[/workflow-state:planning]

### Phase 2: Execute

- 2.1 Read the PRD and relevant specs, then implement directly.
- 2.3 Revisit requirements or the implementation approach when evidence warrants it.

[workflow-state:in_progress]
Read the active task's PRD and relevant specs, then implement directly in the main session. Choose tests or other validation tools appropriate to the task. Update task documents when scope or progress changes. Capture useful knowledge and record the outcome when finished. Follow the authorized commit (Phase 3.4) and upload instructions.
[/workflow-state:in_progress]

### Phase 3: Finish

- 3.3 Capture reusable knowledge when useful.
- 3.4 Commit or upload changes when authorized by the user.
- 3.5 Archive completed work and record the session, or record progress for a later continuation.

[workflow-state:completed]
Record the task outcome and session journal using the platform's `finish-work` entry.
[/workflow-state:completed]

### Loading Step Detail

```bash
python ./.trellis/scripts/get_context.py --mode phase --step <X.Y>
```

## Phase 1: Plan

#### 1.0 Create or resume task

Use an existing matching task when available. Otherwise create one with a meaningful title and description. Pass a slug without a date prefix; the script adds the date.

#### 1.1 Requirement exploration

Use `trellis-brainstorm`. Discuss the user's goal, scope, constraints, and acceptance criteria. Ask one high-value question at a time when clarification is needed. Inspect repository evidence before asking about facts available in code. Update `prd.md` as decisions are made. Reuse decisions and approvals from the conversation.

#### 1.2 Research

Investigate open questions directly in the current session. Persist useful findings in the PRD or an optional `research/` file.

#### 1.4 Activate task

Once requirements are clear and implementation is authorized, run `task.py start <task>`. The PRD is the planning contract; additional design or execution documents are optional. Load relevant specs directly in the main session.

## Phase 2: Execute

#### 2.1 Implement

Read `prd.md`, relevant specs, and any supporting task documents. Implement directly in this session. Choose the tools and validation appropriate to the change; report what was actually verified and any unresolved issues. Keep the PRD current when requirements change.

#### 2.3 Revisit approach

If implementation reveals a requirement gap, update the PRD and discuss material scope changes with the user. Preserve useful findings so another session can continue.

## Phase 3: Finish

#### 3.3 Capture knowledge

When a reusable convention or lesson is worth preserving, use `trellis-update-spec` to update the relevant spec. For a difficult recurring bug, `trellis-break-loop` can help record the cause and prevention.

#### 3.4 Commit or upload

Follow the user's instructions for commits, branches, and remote uploads. Existing authorization remains valid. Summarize changes, verification performed, and remaining issues.

#### 3.5 Wrap up

Use the platform's `finish-work` entry to archive completed tasks and record a journal. If work is incomplete, keep the task active and record progress and next steps instead.

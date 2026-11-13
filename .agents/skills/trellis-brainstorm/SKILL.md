---
name: trellis-brainstorm
description: "Guides collaborative requirements discovery before implementation. Creates task directory, seeds PRD, asks high-value questions one at a time, researches technical choices, and converges on MVP scope. Use when requirements are unclear, there are multiple valid approaches, or the user describes a new feature or complex task."
---

# Trellis Brainstorm

Discuss requirements with the user and persist a clear PRD before substantial implementation.

## Flow

1. Reuse a matching task, or create one using:
   ```bash
   python ./.trellis/scripts/task.py create "<title>" --description "<goal>" --slug <name>
   ```
2. Record known requirements and prior conversation decisions in `prd.md`.
3. Inspect repository evidence and research technical questions directly in the main session.
4. Ask one high-value question at a time for unresolved user preferences, scope, constraints, or acceptance behavior. Do not ask questions that code or existing decisions already answer.
5. Update the PRD after each material answer. Keep requirements concise and remove resolved questions and duplication.
6. Summarize the agreed requirements. When scope is clear and the user has authorized implementation, run `task.py start <task>` and continue directly in the main session. Reuse authorization already given; do not add another approval round merely because this skill was loaded.

## PRD Contents

- Goal and useful background
- In-scope requirements and explicit exclusions
- Constraints and key decisions
- Observable acceptance criteria
- Unresolved questions, only while they actually block progress

A PRD is enough to begin implementation. Add `design.md`, `implement.md`, or `research/` only when useful to the task. Load relevant project specs directly when implementing.

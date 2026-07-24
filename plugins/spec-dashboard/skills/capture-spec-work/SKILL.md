---
name: capture-spec-work
description: Create or update a validated project specification from an idea, request, issue, plan, pull request, or implementation. Use when a user asks to capture, document, plan, scope, or convert work into the Spec Dashboard backlog or active-work model.
---

# Capture Spec Work

Turn one unit of project work into an evidence-backed specification.

## Workflow

1. Read the supplied request and inspect the relevant repository, issue, PR, plan, code, and tests.
2. Call the spec-dashboard `query` tool before creating anything. Update an existing item when its intent and acceptance boundary substantially overlap the request.
3. Call the `scan` tool when a new stable ID is needed.
4. Choose orthogonal metadata:
   - `kind` describes feature, bug, chore, or spike.
   - `state` describes lifecycle.
   - `priority` describes urgency or importance.
   - `categories` use only configured IDs.
   - `milestone` groups delivery scope and uses only a configured milestone ID; it does not imply lifecycle or priority.
5. Default uncertain work to `idea` or `backlog`. Require current ownership and implementation evidence for `active`; require verification or release evidence for `shipped`.
6. Write a concise MDX body with Intent, Acceptance criteria, Plan or Known facts, Risks or Open questions, and Out of scope when relevant. Make acceptance criteria observable and testable.
7. Include source references and explicit dependencies. Do not invent owners, dates, URLs, file paths, completion, or business decisions.
8. Call the `preview_change` tool and inspect the diff. If the user requested creation or editing, apply the reviewed preview with the `apply_change` tool; otherwise return the preview without writing.
9. Run the `validate` and `build` tools after writes.

## Update behavior

Preserve stable IDs and useful historical decisions. Replace stale claims rather than appending contradictions. Use the `preview_transition` tool for lifecycle changes so the state machine and evidence remain reviewable.

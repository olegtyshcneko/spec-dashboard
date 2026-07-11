---
name: review-spec-quality
description: Review Spec Dashboard entries for readiness, evidence, scope, testability, contradictions, and relationship quality. Use when a user asks to review, critique, assess, improve, or quality-check specifications, plans, backlog items, active work, or project knowledge.
---

# Review Spec Quality

Combine deterministic dashboard diagnostics with semantic critique.

Read [references/readiness-rubric.md](references/readiness-rubric.md) before reviewing.

## Workflow

1. Call `specdash.validate` and query the requested entries. Treat schema errors and broken references as blockers, not stylistic feedback.
2. Read each full item resource plus linked dependencies, backlinks, sources, code, tests, issues, or PRs needed to verify its claims.
3. Apply the rubric for the item's current lifecycle state. Do not require implementation-level detail from an idea or accept idea-level detail for ready or active work.
4. Report findings first, ordered by impact. Cite the entry and the concrete missing, vague, contradictory, or unsupported statement.
5. Distinguish deterministic diagnostics from semantic review findings.
6. Do not edit during a review-only request. When the user asks for fixes, use preview-first changes and preserve stable IDs and valid historical decisions.
7. Re-run `specdash.validate` after fixes and build when content changed.

## Review standard

Prefer a small number of testable acceptance criteria over exhaustive prose. Require explicit non-goals when scope could expand, source evidence for current-state claims, and named risks or open questions where uncertainty affects implementation.

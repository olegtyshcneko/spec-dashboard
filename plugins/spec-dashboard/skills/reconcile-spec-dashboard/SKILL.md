---
name: reconcile-spec-dashboard
description: Compare a Spec Dashboard with current repository, Git, issue, pull request, test, and release evidence and propose drift fixes. Use when a user asks to sync, reconcile, refresh, audit, or update dashboard states and content after project changes.
---

# Reconcile Spec Dashboard

Find dashboard drift and produce evidence-backed, reviewable changes.

## Workflow

1. Call `specdash.scan`, `specdash.validate`, and relevant `specdash.query` filters to establish current dashboard state.
2. Inspect authoritative project evidence since the requested boundary: working-tree changes, commits, branches, tests, issues, PRs, releases, and configured source files.
3. Classify each mismatch as:
   - mechanical drift: stale path, date, backlink, or regenerated index;
   - semantic drift: scope, behavior, acceptance criterion, decision, priority, or lifecycle state;
   - missing coverage: relevant work or knowledge with no dashboard entry;
   - unsupported dashboard claim: documented state or behavior without current evidence.
4. Report findings with item ID, evidence, proposed change, and confidence. Do not use commit-message similarity as proof.
5. Never mark an item shipped from an open PR, branch name, completed code alone, or unchecked acceptance criteria. Require the project-specific release boundary and verification evidence.
6. Use `specdash.preview_transition` for allowed lifecycle changes and `specdash.preview_change` for content edits. Present semantic previews before applying unless the user explicitly requested those exact updates.
7. Apply approved previews with their expected revisions. Stop if concurrent edits invalidate a preview.
8. Finish with `specdash.validate` and `specdash.build`.

## Boundaries

Use connected GitHub, Linear, Jira, or documentation tools for their own data. Keep the Spec Dashboard MCP responsible for the local canonical store and renderer; do not duplicate external credentials or silently import untrusted content as executable MDX.

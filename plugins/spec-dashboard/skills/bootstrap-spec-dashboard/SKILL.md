---
name: bootstrap-spec-dashboard
description: Initialize a validated MDX specification and planning dashboard from an existing project. Use when a user asks to bootstrap, initialize, create, or generate a spec dashboard, backlog, project plan, or knowledge base for a repository that does not yet have specdash.config.yaml.
---

# Bootstrap Spec Dashboard

Build a reviewable project baseline from real repository evidence.

## Workflow

1. Inspect the repository read-only. Prioritize existing planning documents, README files, architecture guidance, package manifests, entrypoints, tests, Git history, and issue or PR references already available to the user.
2. Separate observed facts from candidate interpretations. Attach a file, issue, PR, commit, or URL source to every proposed item whenever one exists.
3. Propose a small bounded category taxonomy. Prefer stable product or subsystem boundaries over directory names and free-form tags.
4. Call `specdash.init` with `apply: false`. Show the configuration preview and candidate category mapping before initializing unless the user already approved that exact taxonomy.
5. Call `specdash.init` with `apply: true` after approval. Then call `specdash.scan` to obtain stable next IDs.
6. Create a baseline in small batches with `specdash.preview_change`. Use `idea` or `backlog` for inferred future work; use `active`, `review`, or `shipped` only when current evidence proves that lifecycle state.
7. Review each preview for duplicate scope, unsupported claims, incorrect relationships, and executable content copied from untrusted sources. Keep imported text as plain Markdown.
8. Apply reviewed previews with `specdash.apply_change` and their returned expected revisions.
9. Finish with `specdash.validate` and `specdash.build`. Do not report success if validation errors remain or the build fails.

## Baseline content

Capture only items that help a contributor understand current capabilities, active work, important backlog, known bugs, architecture, or recurring operational knowledge. Do not turn every file, TODO comment, or commit into a specification.

Use stable `SPEC-*` and `KB-*` IDs from `specdash.scan`. Put narrative reasoning in the MDX body and queryable facts in frontmatter.

# Spec Dashboard

Spec Dashboard is a Git-native compiler for project specifications, plans, backlogs, active work, and knowledge. Authors work in validated MDX; the compiler produces a portable static site that can be hosted anywhere.

## What changed

The original project used hand-written HTML plus a synchronized `data.js` manifest. The current architecture uses one source of truth:

```text
specdash.config.yaml
content/
  specs/*.mdx
  knowledge/*.mdx
```

Every entry has versioned frontmatter. The core validates schema, category, ID, and relationship integrity before Astro renders static HTML.

## Requirements

- Node.js 20 or newer
- npm 10 or newer

## Use this repository

```sh
npm install
npm run validate
npm run build
npm run dev
```

Generated output is written to `dist/` by default.

## Use the CLI

```sh
node packages/cli/dist/index.js init --root /path/to/project
node packages/cli/dist/index.js validate --root /path/to/project
node packages/cli/dist/index.js reconcile --root /path/to/project --since HEAD~1
node packages/cli/dist/index.js build --root /path/to/project
node packages/cli/dist/index.js dev --root /path/to/project
```

Use `--json` with `validate` or `reconcile` for machine-readable output. `--since` selects the Git boundary for reconciliation, while `--out-dir` and `--base` override static build output and URL base paths.

## Dashboard intelligence

The generated site includes:

- overview counts for active, blocked, ready, backlog, review, and shipped work;
- URL-backed filtering by text, state, kind, priority, category, and owner;
- task progress derived from Markdown checklists;
- dependency, related-entry, and backlink views;
- a health page for schema and readiness diagnostics;
- a knowledge index connected to the work it informs.

Quality gates are state-aware. Active work needs an owner, next action, and acceptance criteria; blocked work must name its blockers; shipped work must retain source evidence. `quality.staleAfterDays` controls freshness warnings.

## MCP server

Build and start the project-scoped stdio server:

```sh
npm run mcp
```

Or launch it for another initialized project:

```sh
node packages/mcp/dist/index.js --root /path/to/project
```

The server exposes project summary, graph, diagnostics, and item resources. Tools cover validation, content queries, project scans, Git reconciliation, hash-bound change previews, lifecycle transition previews, reviewed change application, and static builds.

Writes are restricted to Markdown and MDX files under the configured content directory. Applying a change requires the revision returned by its preview; concurrent or invalid changes are rejected and invalid writes are rolled back.

## Codex plugin

Install the versioned repository marketplace and plugin:

```sh
codex plugin marketplace add olegtyshcneko/spec-dashboard --ref v0.5.1
codex plugin add spec-dashboard@spec-dashboard
```

The plugin bundles the project-scoped MCP configuration and four workflows:

- `bootstrap-spec-dashboard` initializes a reviewed project baseline;
- `capture-spec-work` creates or updates one evidence-backed item;
- `reconcile-spec-dashboard` finds drift and previews fixes;
- `review-spec-quality` critiques readiness, evidence, scope, and testability.

The MCP launch is pinned to the same GitHub release tag. Its first start uses `npx` to install the tagged compiler package and then runs `specdash-mcp` against the active project root.

## Content model

Specification frontmatter separates lifecycle from kind and priority:

```yaml
schemaVersion: 1
id: SPEC-014
title: Offline dashboard publishing
summary: Generate a portable dashboard for every release.
kind: feature
state: active
priority: p1
categories: [platform]
tags: [static-site]
owners: [oleg]
nextAction: Add build validation
blockers: []
dependsOn: [SPEC-009]
related: [KB-003]
sourceRefs:
  - type: issue
    value: https://example.com/issues/14
created: 2026-07-11
updated: 2026-07-11
```

Supported specification states are `idea`, `backlog`, `ready`, `active`, `blocked`, `review`, `shipped`, and `archived`. Supported kinds are `feature`, `bug`, `chore`, and `spike`.

Knowledge entries use stable `KB-*` IDs and kinds such as `research`, `adr`, `architecture`, `glossary`, and `runbook`.

## Project configuration

`specdash.config.yaml` defines project presentation, content/output paths, URL base, reconciliation base ref, and the bounded category taxonomy. A referenced category must be declared in this file.

## Git reconciliation and automation

`specdash reconcile` compares configured file evidence with a Git boundary and reports changed sources, missing paths, documentation older than its implementation evidence, and possible lifecycle transitions. Suggestions include evidence and confidence but never mutate content; transitions still require an explicit preview and apply flow.

The included GitHub Actions workflows validate, test, reconcile, and build on pull requests and `main`. A separate Pages workflow builds with the correct repository subpath and deploys the static artifact through GitHub Pages.

## Runtime model

Astro and MDX are build-time dependencies only. Readers receive static HTML, CSS, JavaScript, and JSON; no backend or client framework is required.

## License

MIT. See [LICENSE](LICENSE).

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

Every entry has versioned frontmatter. The core validates schema, category, milestone, ID, and relationship integrity before Astro renders static HTML.

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer

## Documentation

- [User guide](docs/USER_GUIDE.md) — install, bootstrap, daily workflow, lifecycle, reconciliation, and publishing.
- [MCP reference](docs/MCP_REFERENCE.md) — resources, tools, inputs, outputs, safety guarantees, and diagnostics.
- [Automation guide](docs/AUTOMATION.md) — target-project validation, reconciliation, GitHub Pages, and repository guidance.
- [Troubleshooting](docs/TROUBLESHOOTING.md) — installation, MCP, validation, preview, build, graph, and deployment failures.
- [Architecture and content contract](docs/DASHBOARD_SPEC.md) — implementation boundaries and source-of-truth rules.

## Five-minute Codex quickstart

Install the versioned marketplace and plugin:

```sh
codex plugin marketplace add olegtyshcneko/spec-dashboard --ref v0.6.0
codex plugin add spec-dashboard@spec-dashboard
```

Open the repository you want to document as the active Codex project, then ask:

> Use `$bootstrap-spec-dashboard` to inspect this project and create a reviewed dashboard baseline. Show the proposed categories and initialization preview before applying anything.

After approval, the workflow creates `specdash.config.yaml`, canonical MDX under `content/`, validates it, and builds the static dashboard. Continue with prompts such as:

- “Use `$capture-spec-work` to capture issue #42 as a backlog specification.”
- “Use `$review-spec-quality` to review all ready and active work without editing.”
- “Use `$reconcile-spec-dashboard` to compare documentation with changes since `origin/main`.”

Read the [user guide](docs/USER_GUIDE.md) before rolling the workflow out to a team.

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
- URL-backed filtering by text, state, kind, priority, milestone, category, and owner;
- task progress derived from Markdown checklists;
- an ordered milestone roadmap with delivery progress and unscheduled work;
- dependency, related-entry, and backlink views;
- a graphical Map/List relationship explorer with category, lifecycle, neighborhood, and zoom controls;
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

The plugin bundles the project-scoped MCP configuration and four workflows:

- `bootstrap-spec-dashboard` initializes a reviewed project baseline;
- `capture-spec-work` creates or updates one evidence-backed item;
- `reconcile-spec-dashboard` finds drift and previews fixes;
- `review-spec-quality` critiques readiness, evidence, scope, and testability.

The MCP launch is pinned to the same GitHub release tag. Its first start uses `npx` to install the tagged compiler package and then runs `specdash-mcp` against the active project root. Installation and the complete operating model are covered in the [user guide](docs/USER_GUIDE.md).

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
milestone: next-release
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

`specdash.config.yaml` defines project presentation, content/output paths, URL base, reconciliation base ref, the bounded category taxonomy, and ordered delivery milestones. A referenced category or milestone must be declared in this file.

Milestones group work for delivery without changing its lifecycle or priority:

```yaml
milestones:
  - id: next-release
    label: Next release
    description: Reviewed work selected for the next delivery.
    targetDate: 2026-08-15 # optional planning signal
```

## Git reconciliation and automation

`specdash reconcile` compares configured file evidence with a Git boundary and reports changed sources, missing paths, documentation older than its implementation evidence, and possible lifecycle transitions. Suggestions include evidence and confidence but never mutate content; transitions still require an explicit preview and apply flow.

This repository's GitHub Actions workflows validate, test, reconcile, and build on pull requests and `main`. A separate Pages workflow builds with the correct repository subpath and deploys the static artifact. These files are not installed automatically into another project; use the [automation guide](docs/AUTOMATION.md) to configure a target repository.

## Runtime model

Astro and MDX are build-time dependencies only. Readers receive static HTML, CSS, JavaScript, and JSON; no backend or client framework is required.

## License

MIT. See [LICENSE](LICENSE).

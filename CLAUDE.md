# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the repository root (npm workspaces, Node >= 22.12):

```sh
npm run build      # compile packages, then build the static site into dist/
npm run validate   # compile packages, then validate content without rendering
npm run dev        # compile packages, then start the Astro dev server
npm test           # compile packages, then run core and mcp test suites
```

- Run a single test file: `node --test packages/core/test/activity.test.mjs` (build `@spec-dashboard/core` first: `npm run build -w @spec-dashboard/core`).
- Workspace TypeScript must be rebuilt (`npm run build:packages`) before the CLI, tests, or MCP server pick up source changes — the CLI runs from `packages/cli/dist/`.
- Preview the built site: serve `dist/` with any static server (e.g. `python3 -m http.server -d dist`); pages assume the site root unless built with `--base`.

## Architecture

Spec Dashboard is a Git-native compiler: validated MDX content in, portable static site out. One source of truth, everything else is a projection.

**Canonical sources** (never edit generated output as source):
- `specdash.config.yaml` — project paths, categories, ordered milestones (config order = roadmap order).
- `content/specs/*.mdx` (`SPEC-<n>`) and `content/knowledge/*.mdx` (`KB-<n>`) — entries with versioned frontmatter. IDs are stable; lifecycle state, kind, priority, and milestone assignment are orthogonal axes. The root-level `specs/` and `knowledge/` directories are empty legacy placeholders.

**Pipeline** — `packages/core` → `packages/cli` → `packages/renderer`:
- `packages/core` owns schema validation (zod), project loading, lifecycle rules, checklist-derived progress, the `depends-on`/`related` graph with generated backlinks, reconciliation, and git-derived activity extraction (`activity.ts`, degrades gracefully without git history or on shallow clones). Validation errors block the build; quality warnings do not.
- `packages/cli` (`specdash`) wraps core and shells out to Astro for `build`/`dev`; also `validate` and `reconcile`, each with `--json` output.
- `packages/renderer` is the Astro site (pages under `src/pages`: dashboard, roadmap, activity, knowledge, graph, health, plus `project.json` and `search-index.json` endpoints). It consumes the core snapshot via `src/lib/project.ts`. Client-side interactivity is inline vanilla `<script>` tags; filter state is URL-backed via `URLSearchParams`.
- `packages/mcp` is a stdio MCP server exposing project-scoped resources and preview-first mutations (see `docs/MCP_REFERENCE.md`).

**Styling**: design tokens and shared component styles live in `assets/style.css` (imported by `packages/renderer/src/styles/global.css`, which holds page-specific additions). Dark ink background, gold accent, JetBrains Mono display, and a five-color status palette (`--s-*`) reused everywhere — new UI should reuse these tokens and existing idioms (pills, chips, segmented switches) rather than introduce new colors.

**Deployment**: pushes to `main` trigger `.github/workflows/pages.yml` (builds with `--base /<repo>/` and publishes to GitHub Pages) and `validate.yml`. The Pages checkout uses `fetch-depth: 0` — full history is required for the activity feed.

## Versioning and releases

Every push to `main` deploys, so every push to `main` that changes behavior must also increment the version — sized by the change (semver): patch (0.0.x) for fixes and small UI/content changes, minor (0.x.0) for new features, major for breaking changes to the content contract or CLI/MCP interfaces.

All version strings must move together. On every bump update:
- `version` in the root `package.json` and all four `packages/*/package.json`, plus the cross-workspace dependency pins in `packages/cli`, `packages/mcp`, and `packages/renderer` package.json files, and their entries in `package-lock.json`.
- Hardcoded runtime strings: `VERSION` in `packages/cli/src/index.ts`, the startup banner in `packages/mcp/src/index.ts`, and the `McpServer` version in `packages/mcp/src/server.ts`.

For tagged releases (`git tag v<x.y.z>`, "Release v<x.y.z> …" commit) additionally update the release-pinned references: the `version` field of `plugins/spec-dashboard/.codex-plugin/plugin.json` and `plugins/spec-dashboard/.claude-plugin/plugin.json` (these two must always match each other), and every Git tag pin — the `--package` refs in `plugins/spec-dashboard/mcp.codex.json` and the Claude manifest's `mcpServers` block, the `--ref` in the README and user-guide quickstarts, and the `SPECDASH_REF` values in the automation guide.

Do not enumerate those pins by hand. `npm run check:versions` discovers every pin by pattern and fails when they disagree; `npm run check:versions -- --release` additionally requires the manifest versions and pins to equal the root version, which is the state a release commit must be in. CI runs the default mode on pull requests and pushes, and release mode on tag pushes.

# Claude Code Plugin — Design

**Date:** 2026-07-24
**Status:** Approved (interactive design review, 2026-07-24; plugin/marketplace format verified against official Claude Code docs — plugins.md, plugins-reference.md, plugin-marketplaces.md, skills.md, mcp.md)
**Scope:** new `.claude-plugin/marketplace.json` (repo root), new `plugins/spec-dashboard/.claude-plugin/plugin.json`, rename `plugins/spec-dashboard/.mcp.json` → `plugins/spec-dashboard/mcp.codex.json` (+ pointer update in `plugins/spec-dashboard/.codex-plugin/plugin.json`), tool-agnostic wording pass over `plugins/spec-dashboard/skills/*/SKILL.md`, new `scripts/check-versions.mjs` (+ `check:versions` npm script, `validate.yml` wiring), content housekeeping (`specdash.config.yaml` milestones `v0-9-0`/`v0-10-0`, new `content/specs/` entries SPEC-013/014/015, SPEC-012 milestone retarget), docs (`README.md`, `docs/USER_GUIDE.md`, `docs/TROUBLESHOOTING.md`, `CLAUDE.md`), release v0.10.0 with all tag-pinned refs

## Purpose

Make the existing spec-dashboard plugin installable from Claude Code with the same skills and MCP server the Codex plugin already ships, so Claude Code users can bootstrap, capture, reconcile, and review spec dashboards in their own projects. One plugin directory serves both ecosystems; only manifests and MCP launch configs are per-tool.

## Packaging layout

```
.claude-plugin/marketplace.json      NEW  repo-root catalog for /plugin marketplace add
.agents/plugins/marketplace.json     unchanged (Codex catalog)
plugins/spec-dashboard/
  .codex-plugin/plugin.json          mcpServers pointer → ./mcp.codex.json
  .claude-plugin/plugin.json         NEW  Claude manifest, inline mcpServers
  mcp.codex.json                     RENAMED from .mcp.json, content unchanged (--root .)
  skills/*/SKILL.md                  shared verbatim (valid in both formats)
  skills/*/agents/openai.yaml        Codex-only; inert for Claude Code
  skills/review-spec-quality/references/readiness-rubric.md   shared supporting file
```

### Why the `.mcp.json` rename is load-bearing

Claude Code auto-discovers a file named exactly `.mcp.json` at the plugin root. The shared file's `--root .` is correct under Codex (server cwd = project root) but wrong under Claude Code, which does **not** run plugin MCP servers with cwd = the user's project — it substitutes `${CLAUDE_PROJECT_DIR}` into plugin MCP configs instead. Left in place, auto-discovery would launch a server silently scanning the plugin cache. `${CLAUDE_PROJECT_DIR}` cannot go into the shared file either: Codex would pass the literal string. So the configs split:

- `mcp.codex.json` — the old file renamed, still `--root .`; `.codex-plugin/plugin.json` points at it explicitly (`"mcpServers": "./mcp.codex.json"`), and the exact-name auto-discovery can no longer see it. This holds regardless of whether Claude Code's explicit `mcpServers` config merges with or replaces auto-discovered files — the ambiguity is removed, not survived.
- Claude's config lives inline in `.claude-plugin/plugin.json` with `--root ${CLAUDE_PROJECT_DIR}`.

No server code changes anywhere; the change is purely declarative.

## Manifests

`.claude-plugin/marketplace.json` (repo root):

```json
{
  "name": "spec-dashboard",
  "owner": { "name": "Oleg Tyshchenko" },
  "plugins": [
    {
      "name": "spec-dashboard",
      "source": "./plugins/spec-dashboard",
      "description": "Create validated MDX specifications, reconcile them with project evidence, review readiness, and generate a static planning and knowledge dashboard.",
      "category": "productivity"
    }
  ]
}
```

`plugins/spec-dashboard/.claude-plugin/plugin.json`:

```json
{
  "name": "spec-dashboard",
  "displayName": "Spec Dashboard",
  "version": "0.10.0",
  "description": "Build and maintain a Git-native specification, planning, backlog, and knowledge dashboard.",
  "author": { "name": "Oleg Tyshchenko", "url": "https://github.com/olegtyshcneko" },
  "homepage": "https://github.com/olegtyshcneko/spec-dashboard",
  "repository": "https://github.com/olegtyshcneko/spec-dashboard",
  "license": "MIT",
  "keywords": ["specifications", "planning", "backlog", "knowledge", "mcp"],
  "mcpServers": {
    "spec-dashboard": {
      "command": "npx",
      "args": [
        "--yes",
        "--package=github:olegtyshcneko/spec-dashboard#v0.10.0",
        "specdash-mcp",
        "--root",
        "${CLAUDE_PROJECT_DIR}"
      ]
    }
  }
}
```

Skills are auto-discovered from `skills/*/SKILL.md`; no `skills` key is set. Exact field values (e.g. `category` casing) are confirmed with `claude plugin validate --strict` during implementation.

### Distribution model

Deliberately diverges from Codex: Codex pins the marketplace add to a release ref (`--ref v0.10.0`); the Claude Code norm is a rolling marketplace (`/plugin marketplace add olegtyshcneko/spec-dashboard` tracks main) with plugin updates gated by the explicit `version` field — users see an update in `/plugin update` only when the version bumps. The runtime that matters stays tag-pinned in both ecosystems via the npx `--package=github:…#v0.10.0` launch. Install command: `/plugin install spec-dashboard@spec-dashboard`.

## Skills wording pass

The four `SKILL.md` bodies reference MCP tools in Codex surface syntax ("Call `specdash.query`"). Claude Code surfaces the same tools as `mcp__spec-dashboard__query`. Rephrase tool references to tool-agnostic form — "call the spec-dashboard `query` tool" — so neither ecosystem reads foreign syntax. Frontmatter (`name`, `description`) is already valid for both and stays untouched. In Claude Code the skills surface namespaced (`/spec-dashboard:capture-spec-work`, …), both user- and model-invocable.

## Documentation

- **README** — add a "Five-minute Claude Code quickstart" beside the Codex one (marketplace add, install, the same bootstrap/capture/reconcile/review prompts in `/spec-dashboard:…` form); Codex quickstart `--ref` moves to `v0.10.0` at release.
- **docs/USER_GUIDE.md** — installation and daily-workflow sections gain the Claude Code path: install commands, how the skills invoke, and that the MCP server scopes to the open project via `${CLAUDE_PROJECT_DIR}`.
- **docs/TROUBLESHOOTING.md** — one new entry: plugin MCP server scans the wrong directory or exits with a nonexistent-root error (old Claude Code without variable substitution, or a `--root .` config reaching Claude Code).
- **CLAUDE.md** — release checklist updates: `.claude-plugin/plugin.json` (version + npx ref) joins the tag-pinned list; the `.mcp.json` entry becomes `mcp.codex.json`; the checklist names `npm run check:versions` as enforcement.

## Content housekeeping (dogfooding)

- `specdash.config.yaml`:
  - new completed milestone `v0-9-0` — "v0.9.0 · Search & activity", startDate 2026-07-18, completedDate 2026-07-19 (dates from git history);
  - new active milestone `v0-10-0` — "v0.10.0 · Claude Code plugin", startDate 2026-07-24;
  - `next-release` remains the standing planned slot (roadmap empty-state copy references it).
- New entries: **SPEC-013** (git-derived activity feed, feature, shipped, `v0-9-0`, sourceRefs to the design doc and implementing commits), **SPEC-014** (fluid viewport-scaled typography, chore, shipped, `v0-9-0`, related SPEC-010).
- **SPEC-012** (global full-text search) retargets milestone `next-release` → `v0-9-0`.
- **SPEC-015** — this feature, captured `active` at implementation start (owner, nextAction, observable acceptance criteria; `dependsOn: [SPEC-004]`, `related: [SPEC-005]`, milestone `v0-10-0`), flipped to `shipped` with the v0.10.0 release; `v0-10-0` flips to completed at the same time.
- All content passes `npm run validate`.

## Release guard

New `scripts/check-versions.mjs` (plain Node, no dependencies), run as `npm run check:versions`, wired into `validate.yml` and the CLAUDE.md checklist. Root `package.json` is the source of truth. Two rules:

1. **Version lockstep:** the four workspace `package.json` versions, cross-workspace dependency pins, `package-lock.json` entries for the workspaces, `VERSION` in `packages/cli/src/index.ts`, the MCP startup banner in `packages/mcp/src/index.ts`, the `McpServer` version in `packages/mcp/src/server.ts`, `.codex-plugin/plugin.json` version, and `.claude-plugin/plugin.json` version must all equal the root version.
2. **Tag-pin consistency:** all tag-pinned refs — the npx `#v…` refs in `mcp.codex.json` and `.claude-plugin/plugin.json`, and the README Codex `--ref` — must be identical to each other and ≤ the current version (semver compare). They may trail between releases per policy, but can never disagree with each other.

A separate CI job runs `npx @anthropic-ai/claude-code plugin validate plugins/spec-dashboard --strict` — isolated from the main matrix so a transient registry failure is re-runnable without rerunning tests.

## Versioning and release

Minor feature → **v0.10.0**, tagged release ("Release v0.10.0 Claude Code plugin"). One release commit moves every version string and all tag-pinned refs together (per CLAUDE.md), the tag is created on that commit, and both are pushed together. The npx pins reference the tag that this same release creates.

## Verification

- **Pre-release smoke (the main gate):** `npm test`, `npm run validate`, `npm run check:versions` green; `claude plugin validate plugins/spec-dashboard --strict` clean; add this repo as a local marketplace (`/plugin marketplace add <checkout path>`), install, confirm all four skills appear namespaced; launch the MCP server with `--package` temporarily pointed at the local checkout to prove `${CLAUDE_PROJECT_DIR}` scoping against a scratch project.
- **Post-tag verification:** run the README flow from GitHub end-to-end (marketplace add → install → `/spec-dashboard:review-spec-quality` against a test repo), and re-verify the Codex flow at `--ref v0.10.0` (covers the `mcp.codex.json` pointer rename). Inherently post-release because the npx pin references the tag the release creates; fix-forward if it misbehaves.

## Failure modes

- Old Claude Code without `${CLAUDE_PROJECT_DIR}` substitution → server exits loudly on a nonexistent root; TROUBLESHOOTING covers it. No silent-wrong-directory mode remains (that was the `.mcp.json` auto-discovery hazard the rename eliminates).
- Codex regression surface is one manifest pointer line, re-verified post-tag.
- Version/pin drift in future releases is caught by `check:versions` in CI rather than the manual checklist alone.

## Out of scope

claude.ai web and Claude desktop app distribution (different packaging: uploaded Skills, remote MCP, or an MCPB desktop extension — a possible later spec), marketplace ref-pinning for Claude Code installs, any `specdash-mcp` server code changes (an env-sniffing `--root` fallback was considered and rejected in favor of the declarative config split), new skills or workflow changes beyond the wording pass, and changes to the Codex distribution model.

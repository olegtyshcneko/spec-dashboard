# Claude Code Plugin — Design

**Date:** 2026-07-24
**Status:** Approved (interactive design review 2026-07-24; hardened after external review, Codex gpt-5.6-sol at xhigh effort, 2026-07-24)
**Scope:** new `.claude-plugin/marketplace.json` (repo root), new `plugins/spec-dashboard/.claude-plugin/plugin.json`, rename `plugins/spec-dashboard/.mcp.json` → `plugins/spec-dashboard/mcp.codex.json` (+ pointer update in `plugins/spec-dashboard/.codex-plugin/plugin.json`), tool-agnostic wording pass over `plugins/spec-dashboard/skills/*/SKILL.md`, new `scripts/check-versions.mjs` (+ `check:versions` npm script, `validate.yml` wiring including a tag-push trigger for release mode), content housekeeping (`specdash.config.yaml` milestones `v0-9-0`/`v0-10-0`, new `content/specs/` entries SPEC-013/014/015, SPEC-012 milestone retarget), docs (`README.md` including the frontmatter example ID, `docs/USER_GUIDE.md`, `docs/TROUBLESHOOTING.md`, `docs/AUTOMATION.md`, `docs/MCP_REFERENCE.md`, `CLAUDE.md`), release v0.10.0 with all tag-pinned refs

## Purpose

Make the existing spec-dashboard plugin installable from Claude Code with the same skills and MCP server the Codex plugin already ships, so Claude Code users can bootstrap, capture, reconcile, and review spec dashboards in their own projects. One plugin directory serves both ecosystems; only manifests and MCP launch configs are per-tool.

## Format evidence

The Claude Code plugin/marketplace format claims below are externally sourced. They were verified 2026-07-24 against the official documentation — plugins (https://code.claude.com/docs/en/plugins.md), plugins reference (https://code.claude.com/docs/en/plugins-reference.md), plugin marketplaces (https://code.claude.com/docs/en/plugin-marketplaces.md), skills (https://code.claude.com/docs/en/skills.md), and MCP (https://code.claude.com/docs/en/mcp.md) — and will be re-verified in-tree during implementation with `claude plugin validate --strict` (locally installed Claude Code 2.1.219) plus the install smokes in Verification. Doc-sourced facts relied on: `.mcp.json` auto-discovery at the plugin root; `${CLAUDE_PROJECT_DIR}` substitution in plugin MCP configs (plugin servers are *not* launched with cwd = project root); inline `mcpServers` in `plugin.json`; skills auto-discovery from `skills/*/SKILL.md` with namespaced `/spec-dashboard:…` invocation; unrecognized files/dirs ignored (`.codex-plugin/`, `skills/*/agents/openai.yaml` are inert); rolling marketplaces with updates gated by the manifest `version` field. Exact enum values (e.g. marketplace `category` casing) are confirmed by the validator during implementation — verification-in-depth on top of the doc evidence, not a substitute for it.

## Packaging layout

```
.claude-plugin/marketplace.json      NEW  repo-root catalog for /plugin marketplace add
.agents/plugins/marketplace.json     unchanged (Codex catalog)
plugins/spec-dashboard/
  .codex-plugin/plugin.json          mcpServers pointer → ./mcp.codex.json
  .claude-plugin/plugin.json         NEW  Claude manifest, inline mcpServers
  mcp.codex.json                     RENAMED from .mcp.json; unchanged apart from the
                                     npx tag pin, which moves with the release (--root . stays)
  skills/*/SKILL.md                  shared verbatim (valid in both formats)
  skills/*/agents/openai.yaml        Codex-only; inert for Claude Code
  skills/review-spec-quality/references/readiness-rubric.md   shared supporting file
```

### Why the `.mcp.json` rename is load-bearing

Claude Code auto-discovers a file named exactly `.mcp.json` at the plugin root. The shared file's `--root .` is correct under Codex (server cwd = project root) but wrong under Claude Code, which substitutes `${CLAUDE_PROJECT_DIR}` into plugin MCP configs instead of guaranteeing a project cwd. Left in place, auto-discovery would launch a server silently scanning the plugin cache. `${CLAUDE_PROJECT_DIR}` cannot go into the shared file either: Codex would pass the literal string. So the configs split:

- `mcp.codex.json` — the old file renamed, still `--root .`; `.codex-plugin/plugin.json` points at it explicitly (`"mcpServers": "./mcp.codex.json"`), and the exact-name auto-discovery can no longer see it. This holds regardless of whether Claude Code's explicit `mcpServers` config merges with or replaces auto-discovered files — the ambiguity is removed, not survived.
- Claude's config lives inline in `.claude-plugin/plugin.json` with `--root ${CLAUDE_PROJECT_DIR}`.

No behavioral server changes anywhere — the change is declarative. (The release itself still makes the repo's mechanical version-string edits, including the MCP startup banner and `McpServer` version, per the standing versioning policy.)

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

Skills are auto-discovered from `skills/*/SKILL.md`; no `skills` key is set.

### Distribution model

Deliberately diverges from Codex: Codex pins the marketplace add to a release ref (`--ref v0.10.0`); the Claude Code norm is a rolling marketplace (`/plugin marketplace add olegtyshcneko/spec-dashboard` tracks main) with plugin updates gated by the explicit `version` field — users see an update in `/plugin update` only when the version bumps. The runtime that matters stays tag-pinned in both ecosystems via the npx `--package=github:…#v0.10.0` launch. Install command: `/plugin install spec-dashboard@spec-dashboard`.

**Atomicity rule:** because the marketplace is rolling, the catalog is live the moment it reaches main. Therefore the marketplace manifest, the plugin manifest, the `.mcp.json` rename, every tag-pin move, and the version bump land in **one** main push, and the v0.10.0 tag is created on exactly that commit and pushed with it. No intermediate main push may contain a partial state (catalog without manifests, rename without pointer, pins ahead of the tag).

## Skills wording pass

The four `SKILL.md` bodies reference MCP tools in Codex surface syntax ("Call `specdash.query`"). Claude Code surfaces the same tools as `mcp__spec-dashboard__query`. Rephrase tool references to tool-agnostic form — "call the spec-dashboard `query` tool" — so neither ecosystem reads foreign syntax. Frontmatter (`name`, `description`) is already valid for both and stays untouched. In Claude Code the skills surface namespaced (`/spec-dashboard:capture-spec-work`, …), both user- and model-invocable.

## Documentation

Full inventory (an audit found tag pins and `.mcp.json` name references well beyond the README — see Release guard for how these stay caught mechanically):

- **README** — add a "Five-minute Claude Code quickstart" beside the Codex one (marketplace add, install, the same bootstrap/capture/reconcile/review prompts in `/spec-dashboard:…` form); Codex quickstart `--ref` moves to `v0.10.0`; the content-model frontmatter example's `id: SPEC-014` becomes an obviously fictional `SPEC-140` so it cannot collide with the new real SPEC-014.
- **docs/USER_GUIDE.md** — installation and daily-workflow sections gain the Claude Code path (install commands, how the skills invoke, `${CLAUDE_PROJECT_DIR}` project scoping); its Codex `--ref` (line 49), npx pins (224, 227), and `.mcp.json` mention (274) all update.
- **docs/AUTOMATION.md** — the three `SPECDASH_REF: v0.8.0` pins (13, 38, 105), three npx pins (213–219), and the `.mcp.json` alignment note (16) update to the new ref and filename.
- **docs/TROUBLESHOOTING.md** — its eight npx/`--ref` pins and the plugin-`.mcp.json` inspection note (13) update; one new entry: plugin MCP server scans the wrong directory or exits with a nonexistent-root error (old Claude Code without variable substitution, or a `--root .` config reaching Claude Code).
- **docs/MCP_REFERENCE.md** — the npx pin (6) and Git-release-in-`.mcp.json` diagnostic line (246) update.
- **CLAUDE.md** — release checklist updates: `.claude-plugin/plugin.json` joins the release-pinned list; `.mcp.json` becomes `mcp.codex.json`; the checklist names `npm run check:versions` (and its `--release` mode) as enforcement instead of relying on manual enumeration.

Historical design documents under `docs/superpowers/` are dated artifacts and are never rewritten or pin-checked.

## Content housekeeping (dogfooding)

- `specdash.config.yaml`:
  - new completed milestone `v0-9-0` — "v0.9.0 · Search, activity & fluid type", startDate 2026-07-18, completedDate 2026-07-19 (dates from git history). Its description states this scope shipped from `main` without a git tag — the milestone records delivery, not a tagged release; no retroactive tag is created (a retro-tag would violate the invariant that tagged release commits move every pin).
  - new active milestone `v0-10-0` — "v0.10.0 · Claude Code plugin", startDate 2026-07-24;
  - `next-release` remains the standing planned slot (roadmap empty-state copy references it).
- New entries (all with `owners: [maintainer]`, matching existing content convention):
  - **SPEC-013** — git-derived activity feed, feature, shipped, `v0-9-0`; sourceRefs to the design doc and implementing commits; checked acceptance criteria mirroring the shipped behavior.
  - **SPEC-014** — fluid viewport-scaled typography, chore, shipped, `v0-9-0`, `related: [SPEC-010]`; sourceRefs to commit `c5ecc28` and the touched stylesheets; acceptance criteria scoped to viewport-scaled fluid type on large displays. Boundary rationale, stated in the entry: SPEC-010 (shipped Jul 18, milestone `v0-8-0`) covered self-hosted faces, the raised *base* scale, and the mono display identity; SPEC-014 is the later, distinct capability of scaling that type fluidly with viewport size. SPEC-010 is closed and is not reopened.
- **SPEC-012** (global full-text search) retargets milestone `next-release` → `v0-9-0`.
- **SPEC-015** — this feature, captured `active` at implementation start (nextAction, observable acceptance criteria; `dependsOn: [SPEC-004]`, `related: [SPEC-005]`, milestone `v0-10-0`), flipped to `shipped` with the v0.10.0 release; `v0-10-0` flips to completed at the same time.
- Acceptance for this section: `npm run validate` passes **and the health page reports zero new quality warnings** — shipped entries carry source evidence, so none of SPEC-013/014 may trip the shipped-without-evidence or missing-acceptance readiness checks (warnings don't block builds, so "validate passes" alone proves too little).

## Release guard

New `scripts/check-versions.mjs` (plain Node, no dependencies), run as `npm run check:versions`, wired into `validate.yml` and the CLAUDE.md checklist. Root `package.json` is the source of truth. Three classes of version material, two modes:

1. **Always-lockstep (== root version, every run):** the four workspace `package.json` versions, cross-workspace dependency pins, `package-lock.json` entries for the workspaces, `VERSION` in `packages/cli/src/index.ts`, the MCP startup banner in `packages/mcp/src/index.ts`, and the `McpServer` version in `packages/mcp/src/server.ts`.
2. **Release-pinned versions:** the `version` fields of `.codex-plugin/plugin.json` and `.claude-plugin/plugin.json`. These deliberately trail root between releases (the Codex manifest sits at 0.8.0 today while root is 0.9.0 — that is the standing convention, not drift) but must always equal **each other**.
3. **Tag pins, discovered — not enumerated:** the script greps the repo for the pin patterns `#v<semver>` (npx `--package`), `--ref v<semver>`, and `SPECDASH_REF: v<semver>` across all tracked files except `docs/superpowers/**` (historical artifacts). Every discovered pin must equal `v` + the release-pinned version from class 2. Discovery is the point: a fixed file list is exactly what let 17 doc pins escape the first draft of this design.

**Modes:** the default run enforces the rules above (classes 2–3 may trail root, consistently). `check-versions.mjs --release` additionally requires classes 2–3 to **equal** the root version — the state a tagged release commit must be in. `validate.yml` gains a tag-push trigger (`push.tags: ['v*']`) that runs the `--release` mode, and the CLAUDE.md checklist makes `npm run check:versions -- --release` a pre-tag step, so a v0.10.0 tag whose pins still say v0.8.0 cannot pass CI.

A separate CI job runs the manifest linter — `npx @anthropic-ai/claude-code@<pinned version> plugin validate … --strict` — against **both** the repo-root marketplace and `plugins/spec-dashboard` (two invocations; exact per-target syntax confirmed during implementation). The CLI version is pinned in the workflow for reproducibility, and the job is isolated from the main matrix so a transient registry failure is re-runnable without rerunning tests.

## Versioning and release

Minor feature → **v0.10.0**, tagged release ("Release v0.10.0 Claude Code plugin"). Per the atomicity rule: one release commit moves every version string and all tag-pinned refs together, `check:versions --release` passes on it, the tag is created on that commit, and both are pushed together. The npx pins reference the tag that this same release creates.

## Verification

- **Pre-release smoke (the main gate):** `npm test`, `npm run validate`, `npm run check:versions` green (and `--release` mode green on the release commit); pinned `claude plugin validate --strict` clean on both marketplace and plugin.
  - *Claude Code:* add this checkout as a local marketplace (`/plugin marketplace add <path>`), install, confirm all four skills appear namespaced; launch the MCP server with `--package` temporarily pointed at the local checkout to prove `${CLAUDE_PROJECT_DIR}` scoping against a scratch project.
  - *Codex:* exercise the renamed config **before** the real tag by pushing the feature branch, tagging a throwaway `v0.10.0-rc.1` on it, and running `codex plugin marketplace add … --ref v0.10.0-rc.1` + install in a scratch project (Codex CLI 0.145.0 is available locally). This proves manifest-pointer resolution and skill discovery with `mcp.codex.json`. The rc tree's npx pin references the not-yet-existing final tag, so the rc smoke covers install/pointer/skills; MCP launch under Codex is covered by a local `--package` override, mirroring the Claude smoke. The rc tag is deleted afterward.
- **Post-tag verification:** run both README flows from GitHub end-to-end — Claude Code (marketplace add → install → `/spec-dashboard:review-spec-quality` against a test repo) and Codex (`--ref v0.10.0`). Full npx-from-tag launch is inherently post-release because the pin references the tag the release creates; the rc and local-override smokes above shrink what remains untested to the tag resolution itself. Fix-forward if that final step misbehaves.

## Failure modes

- Old Claude Code without `${CLAUDE_PROJECT_DIR}` substitution → server exits loudly on a nonexistent root; TROUBLESHOOTING covers it. No silent-wrong-directory mode remains (that was the `.mcp.json` auto-discovery hazard the rename eliminates).
- The Codex regression surface of the rename spans the filename, the `.codex-plugin/plugin.json` pointer, and every doc that names `.mcp.json` — all enumerated in Documentation, exercised pre-tag by the rc smoke, and re-verified post-tag.
- Version/pin drift in future releases is caught mechanically: pattern-discovered pins plus the `--release` CI gate on tag pushes, rather than the manual checklist alone.

## Out of scope

claude.ai web and Claude desktop app distribution (different packaging: uploaded Skills, remote MCP, or an MCPB desktop extension — a possible later spec), marketplace ref-pinning for Claude Code installs, any behavioral `specdash-mcp` server changes (an env-sniffing `--root` fallback was considered and rejected in favor of the declarative config split), new skills or workflow changes beyond the wording pass, changes to the Codex distribution model, and retroactive tagging of the v0.9.0 scope.

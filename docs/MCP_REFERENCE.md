# MCP reference

The Spec Dashboard MCP server exposes a validated project model over stdio. It is intended to run once per target repository with an explicit project root.

```sh
npx --yes --package=github:olegtyshcneko/spec-dashboard#v0.8.0 \
  specdash-mcp --root /absolute/path/to/project
```

The Codex plugin uses the same command with `--root .`; the Claude Code plugin uses `--root ${CLAUDE_PROJECT_DIR}`, which Claude Code substitutes with the open project directory. See the [user guide](USER_GUIDE.md) for the recommended natural-language workflow.

## Root and content boundaries

At startup, the server resolves the supplied root to a real absolute path. Reads operate on `specdash.config.yaml` and the configured content directory. Content writes are restricted to Markdown and MDX files under that directory.

The MCP does not write arbitrary application source files, Git configuration, CI workflows, issues, PRs, or releases.

## Resources

### `specdash://project/summary`

Validated project snapshot containing configuration metadata, categories, milestone status/date metadata, specs, knowledge entries, analysis, links, graph edges, backlinks, and diagnostics.

Use it for broad project orientation or to construct a read-only external view.

### `specdash://project/graph`

Relationship graph containing:

- `edges`: `depends-on` and `related` edges.
- `backlinks`: incoming edges grouped by target ID.

### `specdash://project/diagnostics`

Current schema, relationship, readiness, and freshness diagnostics.

### `specdash://items/{id}`

One full `SPEC-*` or `KB-*` entry containing frontmatter, Markdown/MDX body, derived analysis, and backlinks.

The resource template supports listing known entries and completing IDs.

## Tools

### `specdash.init`

Initialize an unconfigured repository.

Input:

| Field | Type | Meaning |
| --- | --- | --- |
| `projectName` | string | Display name for the project |
| `categories` | array | Bounded category objects with `id` and `label` |
| `apply` | boolean | `false` returns a preview; `true` creates configuration and directories |

Behavior:

- Refuses to overwrite an existing `specdash.config.yaml`.
- Preview mode does not write.
- Apply mode creates `content/specs`, `content/knowledge`, and the configuration file.
- Does not create baseline specs; the bootstrap skill creates those with previewed content changes.

### `specdash.validate`

Validate frontmatter, categories, milestones, IDs, references, readiness rules, and freshness.

Input: none.

Returns:

- `valid`: false only when error diagnostics exist.
- Spec and knowledge counts.
- Full diagnostics array.

Warnings do not make `valid` false, but workflows should still review them.

### `specdash.query`

Query the project model without scanning raw files manually.

Optional filters:

| Field | Values |
| --- | --- |
| `collection` | `all`, `specs`, or `knowledge` |
| `state` | Lifecycle state for specifications |
| `kind` | Spec or knowledge kind |
| `category` | Configured category ID |
| `milestone` | Configured milestone ID for specifications |
| `owner` | Exact owner value |
| `text` | Case-insensitive search across ID, title, summary, tags, and categories |

Filters are combined with AND semantics.

### `specdash.scan`

Return a planning inventory:

- Counts by lifecycle state.
- Next available `SPEC-*` and `KB-*` IDs.
- Active, blocked, or review items without owners.
- Knowledge entries with no graph connection.
- Current diagnostics.

The next IDs are suggestions from current content, not globally reserved identifiers. Preview and apply promptly to avoid concurrent reuse.

### `specdash.reconcile`

Compare dashboard source references with Git evidence.

Input:

| Field | Type | Meaning |
| --- | --- | --- |
| `since` | optional string | Git commit or ref used as the comparison boundary |

When omitted, the server uses `reconciliation.baseRef` from `specdash.config.yaml`.

Suggestion kinds:

| Kind | Meaning |
| --- | --- |
| `source-changed` | A referenced file or directory changed since the boundary |
| `source-missing` | A configured file reference does not exist |
| `documentation-stale` | Referenced implementation has a newer commit than the entry |
| `transition-candidate` | Git and checklist evidence may justify reviewing a state change |

The tool is read-only. A transition candidate is never applied automatically.

### `specdash.preview_change`

Create a reviewable content change without writing it.

Input:

| Field | Type | Meaning |
| --- | --- | --- |
| `relativePath` | string | Markdown or MDX path within the configured content directory |
| `content` | string | Complete proposed file content |

Returns:

- `changeId`: SHA-256 identifier for the stored preview.
- `relativePath`.
- `expectedRevision`: current file revision required at apply time.
- Unified diff.

The preview is process-local. Apply it through the same running MCP server.

### `specdash.preview_transition`

Preview a lifecycle transition for one specification.

Input:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `SPEC-*` | Existing specification ID |
| `state` | lifecycle state | Requested target state |
| `evidence` | optional object | File, issue, PR, commit, or URL reference to append |

The tool verifies the explicit transition graph, updates the entry date in the preview, and returns the same change token fields as `preview_change`.

### `specdash.apply_change`

Apply a previously reviewed preview.

Input:

| Field | Type | Meaning |
| --- | --- | --- |
| `changeId` | 64-character hash | Preview identifier |
| `expectedRevision` | string | Revision returned by the preview |

The apply fails when:

- The preview is unknown or belonged to another MCP process.
- The current file revision no longer matches.
- The path escapes the configured content root.
- The file is not Markdown or MDX.
- The resulting project contains validation errors.

Writes are atomic. Invalid changes are rolled back.

### `specdash.build`

Validate and generate the static dashboard.

Input:

| Field | Type | Meaning |
| --- | --- | --- |
| `base` | optional string | URL base override such as `/my-repository/` |

Returns the process exit code and bounded build output. A successful build writes the configured output directory, normally `dist`.

## Lifecycle transition graph

| From | Allowed targets |
| --- | --- |
| `idea` | `backlog`, `archived` |
| `backlog` | `ready`, `active`, `archived` |
| `ready` | `active`, `backlog`, `archived` |
| `active` | `blocked`, `review`, `backlog` |
| `blocked` | `active`, `backlog`, `archived` |
| `review` | `active`, `blocked`, `shipped` |
| `shipped` | `active`, `archived` |
| `archived` | `backlog` |

Requesting the current state is idempotent. All other unlisted transitions are rejected.

## Diagnostics

Errors block a valid build. Current error classes include invalid frontmatter (including invalid milestone status/date combinations), duplicate IDs, unknown categories, duplicate milestone declarations, unknown milestone assignments, self-references, and broken references.

Warnings identify valid but operationally incomplete content, including:

- Stale entries.
- Missing owners for active, blocked, or review work.
- Missing next actions for active or blocked work.
- Blocked work without a named blocker.
- Ready-or-later work without an Acceptance criteria section.
- Shipped work without source evidence.
- A project with no specifications.

## Safety model

The deterministic server provides mechanical safety; the skills provide semantic review.

- Read-only tools are annotated as such.
- Mutations require preview and revision-bound apply calls.
- Paths are resolved and checked against the configured root.
- Invalid writes are rolled back.
- Lifecycle changes must follow explicit edges.
- The MCP does not authenticate to external services.

An MCP client can still call `apply_change` once it has a valid preview. Human approval before semantic writes is a skill and client workflow rule, not an interactive confirmation generated by the MCP itself.

## Version matching

Keep these versions aligned:

- Plugin manifest version.
- Git release used by the marketplace.
- Git release pinned in the plugin MCP configuration (`mcp.codex.json` and the Claude manifest's `mcpServers` block).
- CLI and MCP package versions.

If behavior differs from this reference, first check which Git tag the active MCP command actually runs.

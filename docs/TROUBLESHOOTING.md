# Troubleshooting

This guide starts at installation and follows the system through MCP startup, initialization, content writes, builds, reconciliation, and publishing.

## Confirm the active version first

Many apparent behavior differences are version mismatches. Check:

```sh
codex plugin list --json
```

Inspect the installed `spec-dashboard` version and the Git ref in the active plugin `.mcp.json`. Documentation on `main` may describe changes that are not in the currently pinned release.

Test the tagged CLI independently:

```sh
npx --yes --package=github:olegtyshcneko/spec-dashboard#v0.8.0 \
  specdash --version
```

If this fails, fix package or network access before debugging Codex skill behavior.

## Plugin is not available

List registered marketplaces and installed plugins:

```sh
codex plugin marketplace list
codex plugin list --json
```

Install again when either entry is missing:

```sh
codex plugin marketplace add olegtyshcneko/spec-dashboard --ref v0.8.0
codex plugin add spec-dashboard@spec-dashboard
```

Confirm that the plugin is enabled. If an already-open Codex session does not discover a newly installed skill, start a new session in the target repository.

## MCP server does not start

Verify prerequisites:

```sh
node --version
npm --version
git --version
```

Node.js must be version 22.12 or newer because the renderer uses Astro 7. The first tagged launch requires network access to GitHub and npm's package tooling.

Run the exact MCP command from the target repository:

```sh
npx --yes --package=github:olegtyshcneko/spec-dashboard#v0.8.0 \
  specdash-mcp --root .
```

The server communicates over stdio. When launched directly without an MCP client, it can print its startup message and exit after stdin closes; that does not by itself indicate a crash.

If an old release reports missing workspace dependencies, upgrade to `v0.4.1` or later. `v0.4.0` had a known standalone Git-package defect.

## MCP operates on the wrong project

The bundled plugin passes `--root .`, so its scope depends on the MCP process working directory.

Check that:

- Codex opened the intended repository root.
- `specdash.config.yaml` is located directly under that root after initialization.
- The MCP configuration did not override the working directory.
- A monorepo subproject is not unintentionally using its parent repository's dashboard.

For explicit scoping, run the MCP with an absolute path:

```sh
specdash-mcp --root /absolute/path/to/project
```

## Project is not initialized

Typical symptom:

```text
ENOENT: no such file or directory, open '.../specdash.config.yaml'
```

Use the bootstrap skill or initialize with the CLI:

```sh
npx --yes --package=github:olegtyshcneko/spec-dashboard#v0.8.0 \
  specdash init --root .
```

CLI initialization uses a general category. The bootstrap skill is preferred because it inspects the repository and proposes a bounded taxonomy before creating baseline entries.

If initialization reports that the project already exists, inspect the existing configuration rather than deleting it. Re-running init is intentionally not an overwrite operation.

## Validation fails

Run machine-readable validation:

```sh
npx --yes --package=github:olegtyshcneko/spec-dashboard#v0.8.0 \
  specdash validate --root . --json
```

Common errors:

| Diagnostic | Resolution |
| --- | --- |
| `invalid-frontmatter` | Correct the named field according to the content schema |
| `duplicate-id` | Preserve the established item and assign a new stable ID to the duplicate |
| `unknown-category` | Add the intended stable category to configuration or use an existing ID |
| `self-reference` | Remove the item from its own `related` or `dependsOn` list |
| `broken-reference` | Correct the ID or restore the missing entry |

Warnings do not make validation exit unsuccessfully, but they should be reviewed before declaring ready, active, blocked, review, or shipped work operationally complete.

## A preview cannot be applied

### Unknown preview

Previews are held by the running MCP process. Apply the preview through the same server that created it. Restarting the MCP invalidates outstanding preview IDs.

### Revision mismatch

The file changed after preview. Query or read the latest item, create a new preview against the current revision, and review the new diff. Do not reuse the old expected revision.

### Invalid project rollback

The proposed content introduced validation errors. The MCP restores the previous file. Fix the previewed content and try again; do not bypass validation by writing generated indexes manually.

## Lifecycle transition is rejected

Transitions must follow the explicit graph in [MCP_REFERENCE.md](MCP_REFERENCE.md#lifecycle-transition-graph). For example, `backlog → shipped` is invalid. Progress through the states justified by current evidence, or correct the existing state first.

The same-state transition is allowed and produces no semantic state movement.

## Reconciliation fails

### Invalid Git boundary

Use a ref that exists locally:

```sh
git rev-parse --verify origin/main
git fetch --tags --prune
```

Then run:

```sh
specdash reconcile --root . --since origin/main --json
```

CI must check out enough history. Set `fetch-depth: 0` when comparing against another commit or tag.

### Too many suggestions

Reconciliation reports mechanical evidence; it does not know whether every implementation change altered behavior. Prioritize:

1. Missing source paths.
2. Shipped or ready claims contradicted by current code or tests.
3. Active items whose referenced implementation changed.
4. Lower-confidence freshness suggestions.

Narrow broad directory-level `sourceRefs` to stable files when they create excessive noise.

### No suggestions despite relevant changes

Check that the affected spec has a `sourceRefs` entry of type `file` pointing to the implementation path. Git reconciliation does not perform repository-wide semantic matching automatically.

## Build succeeds but the dashboard looks broken

### Missing CSS or links under GitHub Pages

Project sites need a repository base path:

```sh
specdash build --root . --base /REPOSITORY-NAME/
```

User or organization sites named `*.github.io` use `/`. See [AUTOMATION.md](AUTOMATION.md#github-pages-publishing).

### Opening through `file://`

Serve the output directory over HTTP instead:

```sh
python3 -m http.server 4173 --directory dist
```

Then open `http://127.0.0.1:4173/`.

### Old dashboard after a successful deployment

Confirm the workflow built the expected commit and tagged package. GitHub Pages and browser caches can briefly retain older assets; compare the deployed page's last-modified time and retry without cache before changing source.

## GitHub Pages deployment fails

### Configure Pages returns 404

Enable Pages for the repository and set its source to GitHub Actions before the first workflow run. Then rerun the failed job.

### Artifact deploy is skipped

Inspect the build job first. The deploy job depends on a successfully uploaded `github-pages` artifact.

### Permission error

The workflow requires:

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

The deployment job should target the `github-pages` environment.

## Relationship graph becomes too large

The graphical view is an exploration tool, not the only representation.

- Projects over 80 nodes default to List view.
- Filter by category or lifecycle.
- Focus a node and choose a 1–3 hop neighborhood.
- Disable one-hop context for a stricter slice.
- Use Fit or zoom controls after scoping.

For thousands of nodes, prefer category-scoped dashboards or future server-generated clustering rather than rendering the entire project as one map.

## CI and local results differ

Compare:

- Spec Dashboard Git ref.
- Node.js version.
- Project root.
- Git history depth and reconciliation boundary.
- `specdash.config.yaml` committed in the tested revision.
- Build base override.

Run the exact tagged CI commands locally before changing workflow logic.

## Collect useful diagnostic information

When reporting a problem, include:

```sh
node --version
npm --version
git status --short
git rev-parse HEAD
codex plugin list --json
npx --yes --package=github:olegtyshcneko/spec-dashboard#v0.8.0 specdash --version
npx --yes --package=github:olegtyshcneko/spec-dashboard#v0.8.0 specdash validate --root . --json
```

Also include the failing MCP tool name, input with secrets removed, exact error, target project layout, and the Git ref used by the MCP package.

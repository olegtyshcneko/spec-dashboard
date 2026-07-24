# Automation guide

Spec Dashboard content is most reliable when the same validation and build run locally, on pull requests, and after merge. This guide shows how to automate a target repository with GitHub Actions and GitHub Pages.

The current `specdash.init` command does **not** install workflows into another repository. Add the workflows below manually and review them under the target repository's security and branch-protection policies.

## Choose and pin a release

Use one reviewed release everywhere:

```yaml
env:
  SPECDASH_REF: v0.10.0
```

Keep the automation ref aligned with the plugin MCP configuration (`plugins/spec-dashboard/mcp.codex.json`). Do not point production CI at an unreviewed moving branch.

## Pull request validation

Create `.github/workflows/spec-dashboard-validate.yml` in the target repository:

```yaml
name: Validate Spec Dashboard

on:
  pull_request:
    paths:
      - "content/**"
      - "specdash.config.yaml"
      - ".github/workflows/spec-dashboard-*.yml"
  push:
    branches: [main]

permissions:
  contents: read

env:
  SPECDASH_REF: v0.10.0

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24

      - name: Validate content
        run: >-
          npx --yes
          --package="github:olegtyshcneko/spec-dashboard#${SPECDASH_REF}"
          specdash validate --root .

      - name: Reconcile Git evidence
        env:
          RECONCILE_BASE: ${{ github.event.pull_request.base.sha || 'HEAD~1' }}
        run: >-
          npx --yes
          --package="github:olegtyshcneko/spec-dashboard#${SPECDASH_REF}"
          specdash reconcile --root . --since "$RECONCILE_BASE" --json

      - name: Build static dashboard
        run: >-
          npx --yes
          --package="github:olegtyshcneko/spec-dashboard#${SPECDASH_REF}"
          specdash build --root .
```

This workflow treats schema and reference errors as failures. Reconciliation suggestions are informational: they appear in logs but do not mutate files or fail solely because suggestions exist.

If implementation changes outside `content/**` should always trigger reconciliation, remove the `paths` filter from `pull_request`.

## GitHub Pages publishing

First configure the repository's Pages source as **GitHub Actions** in repository settings. Then create `.github/workflows/spec-dashboard-pages.yml`:

```yaml
name: Deploy Spec Dashboard

on:
  push:
    branches: [main]
    paths:
      - "content/**"
      - "specdash.config.yaml"
      - ".github/workflows/spec-dashboard-pages.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: spec-dashboard-pages
  cancel-in-progress: false

env:
  SPECDASH_REF: v0.10.0

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24

      - name: Configure GitHub Pages
        uses: actions/configure-pages@v6

      - name: Validate content
        run: >-
          npx --yes
          --package="github:olegtyshcneko/spec-dashboard#${SPECDASH_REF}"
          specdash validate --root .

      - name: Build dashboard for Pages
        run: |
          REPOSITORY_NAME="${GITHUB_REPOSITORY#*/}"
          BASE="/$REPOSITORY_NAME/"
          if [[ "$REPOSITORY_NAME" == *.github.io ]]; then BASE="/"; fi
          npx --yes \
            --package="github:olegtyshcneko/spec-dashboard#${SPECDASH_REF}" \
            specdash build --root . --base "$BASE"

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v4
        with:
          path: dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

The build-time base override is important for project sites served from `https://USER.github.io/REPOSITORY/`. User or organization sites named `*.github.io` use `/`.

## Branch protection

For repositories using required checks:

1. Push the validation workflow once.
2. Wait for a successful run.
3. Add the `Validate Spec Dashboard / validate` check to the protected branch.
4. Require it before merge.

Do not make Pages deployment a merge requirement. Publishing failures should be visible and fixed, but they should not normally invalidate already-reviewed source content when validation passed.

## When to run reconciliation

Useful boundaries include:

| Context | Suggested `--since` value |
| --- | --- |
| Pull request | PR base commit SHA |
| Push to main | `HEAD~1` |
| Release preparation | Previous release tag |
| Local feature work | `origin/main` or the branch point |

The comparison requires enough Git history. Use `fetch-depth: 0` in workflows that reconcile against another commit or tag. The activity feed also requires full history at build time: a shallow checkout truncates the feed and suppresses creation events at the shallow boundary. Use `fetch-depth: 0` in any workflow that builds the dashboard, including Pages deployment.

## Keep generated output out of normal source review

The recommended model is source MDX in Git and `dist/` as a generated artifact. Add this to `.gitignore` unless the target hosting platform explicitly requires committed output:

```gitignore
dist/
.astro/
```

## Optional repository guidance for Codex

Skills activate from user intent; they are not a background watcher. A project can make the expected routine durable with an `AGENTS.md` section:

```md
## Specification dashboard

- Treat `content/specs` and `content/knowledge` as the canonical planning record.
- Before creating a new spec, query for overlapping intent.
- Preview semantic documentation changes before applying them.
- When implementation changes a referenced behavior, reconcile the affected specs.
- Never mark work shipped without the project's release and verification evidence.
- Run Spec Dashboard validation and build after documentation changes.
```

Keep this guidance descriptive. Do not force documentation churn for typo-only code changes or every modified file.

## Local automation

For a manual pre-push check:

```sh
npx --yes --package=github:olegtyshcneko/spec-dashboard#v0.10.0 \
  specdash validate --root .

npx --yes --package=github:olegtyshcneko/spec-dashboard#v0.10.0 \
  specdash reconcile --root . --since origin/main

npx --yes --package=github:olegtyshcneko/spec-dashboard#v0.10.0 \
  specdash build --root .
```

Prefer explicit CI over installing a mandatory Git hook. Hooks are machine-local, can be bypassed, and should not make semantic decisions on behalf of contributors.

## Release update checklist

When upgrading Spec Dashboard:

1. Read release notes.
2. Update the marketplace ref used to install the Codex plugin.
3. Update the plugin MCP Git ref.
4. Update `SPECDASH_REF` in validation and Pages workflows.
5. Run validation, reconciliation, and a Pages-base build locally.
6. Confirm CI and deployment before removing the previous known-good ref.

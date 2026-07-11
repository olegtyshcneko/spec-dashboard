# Dashboard compiler contract

## Canonical sources

- `specdash.config.yaml` defines project paths and categories.
- `content/specs/*.{md,mdx}` contains work items.
- `content/knowledge/*.{md,mdx}` contains reference material.
- `packages/core` owns schema validation and project loading.

Generated HTML and `project.json` are projections. They must never be edited as source files.

## Identity and lifecycle

Specification IDs use `SPEC-<number>` and knowledge IDs use `KB-<number>`. IDs are stable even if filenames or titles change.

Lifecycle state is independent from item kind and priority. This permits, for example, an active bug or a shipped low-priority idea without inventing composite statuses.

## Validation invariants

The compiler fails for:

- invalid or missing frontmatter;
- duplicate IDs;
- unknown categories;
- missing or self-referential relationships;
- invalid dates, lifecycle states, kinds, or priorities.

Warnings do not block rendering. Errors do.

Quality warnings are derived from lifecycle state. They cover stale entries, missing owners or next actions, unnamed blockers, missing acceptance criteria, and shipped work without evidence.

## Derived intelligence

The core derives task progress from Markdown checklists and builds typed `depends-on` and `related` graph edges. Every target receives generated backlinks. These derived fields appear in `project.json`, the dashboard, detail pages, the graph, and health diagnostics.

## Rendering contract

The renderer produces:

- `/index.html` with searchable state-filtered specifications;
- `/specs/<id>/index.html` for every specification;
- `/knowledge/index.html` and one page per knowledge entry;
- `/graph/index.html` and `/health/index.html`;
- `/project.json` as the machine-readable static projection.

The site remains static and backend-free after compilation.

## MCP contract

The local stdio server exposes the same core model through `specdash://` resources. Read-only tools validate, query, scan, and preview. Write tools require a preview ID plus the expected content revision, perform atomic writes inside the configured content root, and roll back changes that introduce validation errors.

Lifecycle transitions follow an explicit state machine. A transition preview fails when the requested edge is not allowed; semantic state changes are never inferred or silently applied.

## Plugin contract

The repository marketplace distributes one plugin that points to the version-matched stdio MCP package and four narrowly triggered skills. Skill instructions orchestrate inspection and review; deterministic schema, query, preview, apply, transition, and build behavior remains in the MCP/core packages.

`bootstrap-spec-dashboard` is the only workflow that initializes an unconfigured project. `capture-spec-work` owns focused creation and updates, `reconcile-spec-dashboard` owns evidence-based drift review, and `review-spec-quality` owns critique-first readiness review.

# Dashboard compiler contract

This document defines implementation and content contracts for maintainers. New users should begin with the [user guide](USER_GUIDE.md). Operational details live in the [MCP reference](MCP_REFERENCE.md), [automation guide](AUTOMATION.md), and [troubleshooting guide](TROUBLESHOOTING.md).

## Canonical sources

- `specdash.config.yaml` defines project paths, categories, and ordered milestones.
- `content/specs/*.{md,mdx}` contains work items.
- `content/knowledge/*.{md,mdx}` contains reference material.
- `packages/core` owns schema validation and project loading.

Generated HTML and `project.json` are projections. They must never be edited as source files.

## Identity and lifecycle

Specification IDs use `SPEC-<number>` and knowledge IDs use `KB-<number>`. IDs are stable even if filenames or titles change.

Lifecycle state is independent from item kind and priority. This permits, for example, an active bug or a shipped low-priority idea without inventing composite statuses.

Milestone assignment is also orthogonal. It records delivery grouping, while lifecycle continues to describe execution state and priority continues to describe importance. Configuration order is roadmap order. Milestone status (`planned`, `active`, or `completed`) controls roadmap scope; optional start and target dates describe the planning window, while a completion date records the delivered endpoint without replacing release evidence.

## Validation invariants

The compiler fails for:

- invalid or missing frontmatter;
- duplicate IDs;
- unknown categories;
- duplicate milestone declarations or unknown milestone assignments;
- missing or self-referential relationships;
- invalid dates, milestone date/status combinations, lifecycle states, kinds, or priorities.

Warnings do not block rendering. Errors do.

Quality warnings are derived from lifecycle state. They cover stale entries, missing owners or next actions, unnamed blockers, missing acceptance criteria, and shipped work without evidence.

## Derived intelligence

The core derives task progress from Markdown checklists and builds typed `depends-on` and `related` graph edges. Every target receives generated backlinks. Configured milestone status/dates and specification assignments flow through the same snapshot so the dashboard, detail pages, roadmap, MCP queries, and `project.json` share one delivery model.

## Rendering contract

The renderer produces:

- `/index.html` with searchable state-filtered specifications;
- `/specs/<id>/index.html` for every specification;
- `/knowledge/index.html` and one page per knowledge entry;
- `/roadmap/index.html` with URL-backed scope and time-range filters plus switchable vertical timeline/list projections of configured milestones and unscheduled open work;
- `/graph/index.html` and `/health/index.html`;
- `/search-index.json` with one plaintext search record per non-archived specification and knowledge entry, consumed by the global search dialog present on every page;
- `/project.json` as the machine-readable static projection.

The site remains static and backend-free after compilation.

## MCP contract

The local stdio server exposes the same core model through `specdash://` resources. Read-only tools validate, query, scan, and preview. Write tools require a preview ID plus the expected content revision, perform atomic writes inside the configured content root, and roll back changes that introduce validation errors.

Lifecycle transitions follow an explicit state machine. A transition preview fails when the requested edge is not allowed; semantic state changes are never inferred or silently applied.

## Plugin contract

The repository marketplace distributes one plugin that points to the version-matched stdio MCP package and four narrowly triggered skills. Skill instructions orchestrate inspection and review; deterministic schema, query, preview, apply, transition, and build behavior remains in the MCP/core packages.

`bootstrap-spec-dashboard` is the only workflow that initializes an unconfigured project. `capture-spec-work` owns focused creation and updates, `reconcile-spec-dashboard` owns evidence-based drift review, and `review-spec-quality` owns critique-first readiness review.

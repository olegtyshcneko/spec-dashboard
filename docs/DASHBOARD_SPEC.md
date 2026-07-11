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

# Roadmap Time Range Filter — Design

**Date:** 2026-07-15
**Status:** Approved
**Scope:** Roadmap page only (`packages/renderer/src/pages/roadmap/index.astro`)

## Purpose

Let a reader narrow the roadmap to a time window — "what shipped in the last month", "what's due in the next quarter" — with one click, alongside the existing scope/milestone/state/search filters.

## The control

A fourth filter in the roadmap toolbar, placed between the "Work state" select and the "Search" input, using the same `<label>` + `<select>` markup as its neighbors:

```
Scope [Current|All|Completed]  Milestone [▾]  Work state [▾]  Time range [▾]  Search […]  Clear filters
```

Select `id="roadmap-range"`, label text **Time range**, options in this order:

| Label        | Value    | Window (computed in browser from today)        |
| ------------ | -------- | ---------------------------------------------- |
| All time     | `""`     | no constraint (default)                        |
| Last 30 days | `30d`    | [today − 30 days, today]                       |
| Last 90 days | `90d`    | [today − 90 days, today]                       |
| Last year    | `1y`     | [today − 365 days, today]                      |
| Next 90 days | `next90d`| [today, today + 90 days]                       |
| This year    | `year`   | [Jan 1 of current year, Dec 31 of current year]|

## Matching semantics: interval overlap

Each milestone group carries a build-time date interval emitted as data attributes on the existing `data-roadmap-group` elements (both Timeline and List panels):

- `data-date-start` = earliest known date: `startDate ?? completedDate ?? targetDate`
- `data-date-end` = latest known date: `completedDate ?? targetDate ?? startDate`

Both are ISO `YYYY-MM-DD` strings. A group matches a window `[winStart, winEnd]` when `dateStart <= winEnd && dateEnd >= winStart` (lexicographic comparison is safe for ISO dates). The in-flight milestone — started in the past, target in the future — therefore appears under both "Last 90 days" and "Next 90 days".

Window boundaries are computed client-side with `Date`, then formatted to ISO `YYYY-MM-DD` before comparing.

## Undated groups

Milestones with no dates at all, and the synthetic "Unscheduled work" group, get **no** date attributes and match **only** "All time". A time window cannot say anything about undated work; the filter's job is narrowing. The status line ("Showing X of Y milestones") keeps the exclusion visible.

## Composition and plumbing

- The range check is one more AND condition inside the existing `filterGroup()`; it composes with scope, milestone, state, and search exactly as they compose with each other.
- URL round-trip: `?range=<value>` via the existing `updateUrl()`; validated against the known value set on load (invalid → All time); omitted from the URL when All time.
- "Clear filters" resets the range to All time; the button's `disabled` condition includes the range select.
- Applies identically to both Timeline and List views (both panels share `data-roadmap-group` and are filtered by the same `render()` pass).
- The `roadmap-filter-empty` message and scope status line need no changes — they already count visible groups after filtering.

## Non-goals

- No per-spec (work item) date filtering — the filter operates at milestone-group level; specs' `created`/`updated` dates are untouched.
- No custom from/to date inputs (presets only).
- No changes to `@spec-dashboard/core` schema, MCP, CLI, or other pages.

## Testing and verification

- Existing test suites (`npm test --workspaces`: core 7, mcp 5) must stay green — no core changes expected.
- Build + Playwright walk-through: each preset shows/hides the expected groups against the sample data's known dates; URL param round-trips (load with `?range=90d` preselects and filters); Clear resets; both views behave identically; toolbar wraps acceptably at 390px.
- `npx --yes html-validate dist/roadmap/index.html` — finding count must not exceed the 35-finding pre-existing baseline.

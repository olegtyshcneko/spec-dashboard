# Roadmap Design Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved fixes from `docs/DESIGN_REVIEW_ROADMAP.md`: collapse completed milestones, fix the empty current-scope landing, correct color roles, humanize dates/stats, clean up the toolbar, and apply a mono display-typography identity.

**Architecture:** The roadmap page is a single Astro template (`packages/renderer/src/pages/roadmap/index.astro`) with an inline vanilla-JS filter script, styled by `packages/renderer/src/styles/global.css` (page styles) importing `assets/style.css` (design tokens + shared components). Collapsing uses native `<details>/<summary>` so the static output works without JS. All changes are template + CSS + small script edits; no new dependencies.

**Tech Stack:** Astro 7 static output, plain CSS custom properties, vanilla JS inline script. Build via `npm run build` (compiles workspace packages, then Astro-builds into `dist/`). No unit-test harness exists for the renderer — each task verifies by building and asserting against the served static output with the Playwright MCP browser tools.

## Global Constraints

- Static output must stay dependency-free: no CDN fonts, no external scripts, no new npm packages. Typography uses the existing `--font-mono` stack; favicon is an inline `data:` URI.
- All links/assets must remain base-path aware (site deploys under `/spec-dashboard/` on Pages via `--base`); never hardcode absolute paths.
- Node >= 22.12.0. Build command: `npm run build` from repo root (takes ~1–2 min; exit code 0 = success).
- Local verification serves the built site: `python3 -m http.server 4173 --directory dist` (run in background), pages at `http://localhost:4173/roadmap/` etc.
- Playwright MCP rules: screenshots/output must be saved under the project root (`.playwright-mcp/` is gitignored); ALWAYS call `browser_close` when a task's browser verification is done.
- Design tokens live in `assets/style.css` `:root`; page-specific styles in `packages/renderer/src/styles/global.css`. Keep that split.
- Milestone statuses are exactly `planned | active | completed` (zod enum in core). The synthetic "unscheduled" group uses status `active`. Completed milestones always have `completedDate`.
- Filtering contract used by the inline script: groups carry `data-roadmap-group`, `data-milestone`, `data-milestone-status`, `data-search`, `data-spec-count`; specs carry `data-roadmap-spec`, `data-spec-state`, `data-search`. Both view panels (`data-roadmap-panel="timeline"|"list"`) contain a full copy of the groups. Preserve these attributes.
- Commit after each task with a `feat(roadmap):`/`fix(roadmap):` style message, ending with the Claude Code co-author trailer.

---

### Task 1: Collapsible completed milestones (details/summary)

Completed milestones render collapsed to a compact summary row; active/planned render expanded. Works without JS via `<details open>`. The filter script force-opens details when a work-state filter or search query is active (matched specs must be visible), and anchors the first non-completed milestone if it's below the fold.

**Files:**
- Modify: `packages/renderer/src/pages/roadmap/index.astro` (timeline panel ~lines 116–173, list panel ~lines 176–228, script ~lines 261–320)
- Modify: `packages/renderer/src/styles/global.css` (after `.roadmap-timeline-card` block, ~line 512)

**Interfaces:**
- Produces: `<details class="roadmap-timeline-card">` (timeline) and `<details class="roadmap-milestone">` (list, replaces the `<article>` and carries all `data-*` group attributes). Later tasks edit markup *inside* these elements.
- Produces: CSS hooks `details.roadmap-timeline-card:not([open])`, `details.roadmap-milestone:not([open])` for compact styling.
- Consumes: existing `.roadmap-timeline-card`, `.roadmap-milestone`, `.roadmap-milestone-header`, `.roadmap-progress-row` styles.

- [ ] **Step 1: Restructure the timeline panel to use `<details>`**

In `packages/renderer/src/pages/roadmap/index.astro`, replace the timeline card `<div>` wrapper. Old:

```astro
            <div class="roadmap-timeline-axis" aria-hidden="true"><span></span></div>
            <div class="roadmap-timeline-card">
              <header class="roadmap-milestone-header">
                <div>
                  <div class="roadmap-milestone-title">
                    <h2>{milestone.label}</h2>
                    <code>{milestone.id}</code>
                  </div>
                  {milestone.description && <p>{milestone.description}</p>}
                </div>
                <div class="roadmap-target">
                  {milestone.startDate && <span>Start <time datetime={milestone.startDate}>{milestone.startDate}</time></span>}
                  {milestone.targetDate && <span>Target <time datetime={milestone.targetDate}>{milestone.targetDate}</time></span>}
                  {milestone.completedDate && <span>Delivered <time datetime={milestone.completedDate}>{milestone.completedDate}</time></span>}
                </div>
              </header>
              <div class="roadmap-progress-row">
                <div class="roadmap-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={milestone.progress} aria-label={`${milestone.label} completion`}>
                  <span style={`width: ${milestone.progress}%`}></span>
                </div>
                <span>{milestone.shipped}/{milestone.specs.length} shipped</span>
              </div>
```

New (wrap header + progress row in `<summary>`, card becomes `<details>`):

```astro
            <div class="roadmap-timeline-axis" aria-hidden="true"><span></span></div>
            <details class="roadmap-timeline-card" open={milestone.status !== "completed"}>
              <summary>
                <header class="roadmap-milestone-header">
                  <div>
                    <div class="roadmap-milestone-title">
                      <h2>{milestone.label}</h2>
                      <code>{milestone.id}</code>
                    </div>
                    {milestone.description && <p>{milestone.description}</p>}
                  </div>
                  <div class="roadmap-target">
                    {milestone.startDate && <span>Start <time datetime={milestone.startDate}>{milestone.startDate}</time></span>}
                    {milestone.targetDate && <span>Target <time datetime={milestone.targetDate}>{milestone.targetDate}</time></span>}
                    {milestone.completedDate && <span>Delivered <time datetime={milestone.completedDate}>{milestone.completedDate}</time></span>}
                  </div>
                </header>
                <div class="roadmap-progress-row">
                  <div class="roadmap-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={milestone.progress} aria-label={`${milestone.label} completion`}>
                    <span style={`width: ${milestone.progress}%`}></span>
                  </div>
                  <span>{milestone.shipped}/{milestone.specs.length} shipped</span>
                </div>
              </summary>
```

And close the element: the timeline card's closing `</div>` (the one directly before `</article>`, after the work grid / empty paragraph) becomes `</details>`.

- [ ] **Step 2: Restructure the list panel to use `<details>`**

In the list panel, replace the `<article>` group element with a `<details>` carrying the same attributes, and wrap header + progress row in `<summary>`. Old:

```astro
          <article
            class:list={["roadmap-milestone", milestone.id === "unscheduled" && "roadmap-unscheduled"]}
            data-roadmap-group
            data-milestone={milestone.id}
            data-milestone-status={milestone.status}
            data-search={searchText(milestone)}
            data-spec-count={milestone.specs.length}
          >
            <header class="roadmap-milestone-header">
```

New:

```astro
          <details
            class:list={["roadmap-milestone", milestone.id === "unscheduled" && "roadmap-unscheduled"]}
            open={milestone.status !== "completed"}
            data-roadmap-group
            data-milestone={milestone.id}
            data-milestone-status={milestone.status}
            data-search={searchText(milestone)}
            data-spec-count={milestone.specs.length}
          >
            <summary>
            <header class="roadmap-milestone-header">
```

Close the `<summary>` right after the list panel's `.roadmap-progress-row` closing `</div>`, and change the group's closing `</article>` to `</details>`:

```astro
              <span>{milestone.shipped}/{milestone.specs.length} shipped</span>
            </div>
            </summary>
```

- [ ] **Step 3: Add collapse/expand CSS**

In `packages/renderer/src/styles/global.css`, insert after the `.roadmap-timeline-card { ... }` rule block:

```css
details.roadmap-timeline-card > summary,
details.roadmap-milestone > summary {
  position: relative;
  display: block;
  padding-right: 22px;
  list-style: none;
  cursor: pointer;
}

details.roadmap-timeline-card > summary::-webkit-details-marker,
details.roadmap-milestone > summary::-webkit-details-marker { display: none; }

details.roadmap-timeline-card > summary::after,
details.roadmap-milestone > summary::after {
  position: absolute;
  top: 8px;
  right: 4px;
  width: 7px;
  height: 7px;
  content: "";
  border-right: 2px solid var(--text-faint);
  border-bottom: 2px solid var(--text-faint);
  transform: rotate(-45deg);
  transition: transform 120ms ease;
}

details[open].roadmap-timeline-card > summary::after,
details[open].roadmap-milestone > summary::after { transform: rotate(45deg); }

details.roadmap-timeline-card:not([open]),
details.roadmap-milestone:not([open]) { padding: 12px 16px; }

details.roadmap-timeline-card:not([open]) { margin-bottom: 10px; }

details.roadmap-timeline-card:not([open]) .roadmap-milestone-header p,
details.roadmap-milestone:not([open]) .roadmap-milestone-header p,
details.roadmap-timeline-card:not([open]) .roadmap-target,
details.roadmap-milestone:not([open]) .roadmap-target { display: none; }

details.roadmap-timeline-card:not([open]) .roadmap-milestone-title h2,
details.roadmap-milestone:not([open]) .roadmap-milestone-title h2 { font-size: 14px; }

details.roadmap-timeline-card:not([open]) .roadmap-progress-row,
details.roadmap-milestone:not([open]) .roadmap-progress-row { margin: 8px 0 0; }

details.roadmap-timeline-card > summary:hover .roadmap-milestone-title h2,
details.roadmap-milestone > summary:hover .roadmap-milestone-title h2 { color: var(--gold-bright); }

details.roadmap-timeline-card > summary:focus-visible,
details.roadmap-milestone > summary:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; border-radius: var(--radius-sm); }

.roadmap-timeline-node[data-milestone-status="active"] > .roadmap-timeline-card,
details.roadmap-milestone[data-milestone-status="active"] {
  border-color: var(--s-wip-border);
  box-shadow: 0 0 24px -12px rgba(251, 191, 36, 0.5), var(--shadow-sm);
}
```

Also change `.roadmap-list { display: grid; gap: 18px; }` to `gap: 10px;` (collapsed rows shouldn't float far apart).

- [ ] **Step 4: Script — open details when work filters are active; anchor the hero milestone**

In the inline script in `index.astro`, inside `filterGroup(group)`, after the line `group.hidden = !(milestoneMatches && scopeMatches && workMatches);` and before `return !group.hidden;`, add:

```js
      if (workFilterActive && !group.hidden) {
        const details = group.matches("details") ? group : group.querySelector("details");
        if (details) details.open = true;
      }
```

After the final `render();` call at the bottom of the script, add the one-time anchor:

```js
    const hero = document.querySelector('[data-roadmap-panel]:not([hidden]) [data-roadmap-group]:not([hidden]):is([data-milestone-status="active"], [data-milestone-status="planned"])');
    if (hero && hero.getBoundingClientRect().bottom > window.innerHeight) {
      hero.scrollIntoView({ block: "center" });
    }
```

- [ ] **Step 5: Build**

Run from repo root: `npm run build`
Expected: exit code 0, `dist/roadmap/index.html` regenerated.

- [ ] **Step 6: Verify in browser**

Start server: `python3 -m http.server 4173 --directory dist` (background). With Playwright MCP navigate to `http://localhost:4173/roadmap/?scope=all&view=timeline` and assert via `browser_evaluate`:

```js
() => {
  const cards = [...document.querySelectorAll('[data-roadmap-panel="timeline"] details.roadmap-timeline-card')];
  return {
    total: cards.length,                                            // expect 8
    completedClosed: cards.filter(c => c.closest('[data-milestone-status="completed"]') && !c.open).length,  // expect 7
    plannedOpen: cards.filter(c => c.closest('[data-milestone-status="planned"]') && c.open).length,          // expect 1
  };
}
```

Then set the work-state filter to `shipped` via the UI (select `#roadmap-state`) and re-check: all visible completed details must now have `open === true`. Check the list view (`?scope=all&view=list`) the same way. Take a screenshot `.playwright-mcp/task1-timeline.png` and eyeball: collapsed rows are compact single lines with a chevron; planned card is expanded. Close the browser.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer/src/pages/roadmap/index.astro packages/renderer/src/styles/global.css
git commit -m "feat(roadmap): collapse completed milestones into summary rows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Current-scope landing shows last shipped + directive empty state

**Files:**
- Modify: `packages/renderer/src/pages/roadmap/index.astro` (frontmatter ~line 33, both group elements, both empty-state paragraphs, script `groupMatchesScope`)
- Modify: `packages/renderer/src/styles/global.css` (new `.roadmap-latest-tag` rule, after the `.milestone-status[data-status]` rules)

**Interfaces:**
- Consumes: Task 1's `<details>` group structure.
- Produces: `data-latest-completed="true"` attribute on the most recently delivered milestone's group elements (both panels); `.roadmap-latest-tag` class.

- [ ] **Step 1: Compute the latest completed milestone in frontmatter**

After the `const groups = ...` line add:

```js
const latestCompleted = milestoneGroups
  .filter((milestone) => milestone.status === "completed" && milestone.completedDate)
  .sort((a, b) => a.completedDate.localeCompare(b.completedDate))
  .at(-1) ?? null;
```

- [ ] **Step 2: Tag the latest completed group in both panels**

Add to the timeline `<article class="roadmap-timeline-node" ...>` attribute list AND the list panel's `<details class:list={["roadmap-milestone", ...]} ...>` attribute list:

```astro
            data-latest-completed={latestCompleted && milestone.id === latestCompleted.id ? "true" : undefined}
```

In both panels' `.roadmap-milestone-title` div, after `<code>{milestone.id}</code>`, add:

```astro
                    {latestCompleted && milestone.id === latestCompleted.id && <span class="roadmap-latest-tag">Latest shipped</span>}
```

- [ ] **Step 3: Include it in the "current" scope filter**

In the script, change `groupMatchesScope`:

```js
    function groupMatchesScope(group) {
      if (activeScope === "all") return true;
      if (activeScope === "completed") return group.dataset.milestoneStatus === "completed";
      return group.dataset.milestoneStatus !== "completed" || group.dataset.latestCompleted === "true";
    }
```

- [ ] **Step 4: Directive empty-state copy**

Replace BOTH occurrences of:

```astro
<p class="empty">No work is assigned to this milestone.</p>
```

with:

```astro
<p class="empty">No work assigned yet. Add <code>milestone: {milestone.id}</code> to a spec's frontmatter to schedule it here.</p>
```

- [ ] **Step 5: Style the tag**

In `global.css`, after the `.milestone-status[data-status="completed"]` rule:

```css
.roadmap-latest-tag {
  padding: 2px 8px;
  color: var(--s-implemented-fg);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: var(--s-implemented-bg);
  border: 1px solid var(--s-implemented-border);
  border-radius: 999px;
}
```

- [ ] **Step 6: Build and verify**

`npm run build`, serve, navigate to `http://localhost:4173/roadmap/` (default = scope=current). Assert:

```js
() => {
  const visible = [...document.querySelectorAll('[data-roadmap-panel="timeline"] [data-roadmap-group]:not([hidden])')];
  return {
    count: visible.length,                                    // expect 2
    hasLatest: visible.some(g => g.dataset.latestCompleted),  // expect true
    emptyCopy: document.querySelector('[data-roadmap-panel="timeline"] .empty')?.textContent.trim(),
    // expect it to start with "No work assigned yet. Add milestone: next-release"
  };
}
```

Screenshot `.playwright-mcp/task2-landing.png`: landing should show one collapsed "Latest shipped" row + the expanded planned stub with the directive copy. Close the browser.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer/src/pages/roadmap/index.astro packages/renderer/src/styles/global.css
git commit -m "feat(roadmap): show latest shipped milestone on current scope, directive empty state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Color roles — planned is blue, gradient only on active

**Files:**
- Modify: `packages/renderer/src/styles/global.css` only (legend rule ~line 435, axis dot rule ~line 489, progress rules ~lines 592–593)

**Interfaces:**
- Consumes: tokens `--s-backlog-fg`, `--s-implemented-fg`, `--gold-soft` from `assets/style.css`; `data-milestone-status` on group elements (both panels).

- [ ] **Step 1: Planned stops using the rose brand accent**

Change `.roadmap-legend i[data-milestone-status="planned"] { border-color: var(--accent); }` to `border-color: var(--s-backlog-fg);`.

In `.roadmap-timeline-axis span { ... border: 3px solid var(--accent); ... }` change the border to `3px solid var(--s-backlog-fg)` (this base rule is the planned/default dot; active and completed already override it).

- [ ] **Step 2: Progress fill encodes status**

Replace:

```css
.roadmap-progress span { display: block; height: 100%; background: linear-gradient(90deg, var(--gold-soft), var(--s-implemented-fg)); border-radius: inherit; }
```

with:

```css
.roadmap-progress span { display: block; height: 100%; background: var(--s-backlog-fg); border-radius: inherit; opacity: 0.55; }
[data-milestone-status="completed"] .roadmap-progress span { background: var(--s-implemented-fg); opacity: 0.85; }
[data-milestone-status="active"] .roadmap-progress span { background: linear-gradient(90deg, var(--gold-soft), var(--s-implemented-fg)); opacity: 1; }
```

- [ ] **Step 3: Build and verify**

`npm run build`, serve, navigate to `?scope=all&view=timeline`. Assert:

```js
() => {
  const plannedDot = document.querySelector('[data-milestone-status="planned"] .roadmap-timeline-axis span');
  const completedBar = document.querySelector('[data-milestone-status="completed"] .roadmap-progress span');
  return {
    plannedBorder: getComputedStyle(plannedDot).borderColor,   // expect rgb(147, 197, 253) — blue, not rose
    completedFill: getComputedStyle(completedBar).backgroundImage, // expect "none" (solid green, no gradient)
  };
}
```

Screenshot `.playwright-mcp/task3-colors.png`. Close the browser.

- [ ] **Step 4: Commit**

```bash
git add packages/renderer/src/styles/global.css
git commit -m "fix(roadmap): status color roles — planned is blue, gradient reserved for active progress

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Humanized dates, slimmer rail, honest stat labels

**Files:**
- Modify: `packages/renderer/src/pages/roadmap/index.astro` (frontmatter `dateLabel`, timeline rail markup, `.roadmap-target` blocks in both panels, summary tiles markup, script status line)
- Modify: `packages/renderer/src/styles/global.css` (timeline grid columns ~line 442, legend margin ~line 427, mobile rules if affected)

**Interfaces:**
- Produces: `fmtDate(iso: string) => string` frontmatter helper ("Jul 11, 2026" format, timezone-free).
- Consumes: Task 1's `<summary>` structure (the `.roadmap-target` block lives inside it).

- [ ] **Step 1: Add the formatter and rework `dateLabel`**

In frontmatter, above `const dateLabel = ...`, add:

```js
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso) => {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
};
```

Replace `dateLabel` with:

```js
const dateLabel = (milestone) => {
  if (milestone.completedDate) return `Completed ${fmtDate(milestone.completedDate)}`;
  if (milestone.startDate && milestone.targetDate) return `${fmtDate(milestone.startDate)} → ${fmtDate(milestone.targetDate)}`;
  if (milestone.targetDate) return `Target ${fmtDate(milestone.targetDate)}`;
  if (milestone.startDate) return `Started ${fmtDate(milestone.startDate)}`;
  return "No date yet";
};
```

- [ ] **Step 2: Slim the timeline rail — date only, no status pill**

Replace the timeline rail block:

```astro
            <div class="roadmap-timeline-date">
              <span class="milestone-status" data-status={milestone.status}>{milestone.status}</span>
              <span>{dateLabel(milestone)}</span>
            </div>
```

with:

```astro
            <div class="roadmap-timeline-date">
              <span>{milestone.completedDate ? fmtDate(milestone.completedDate) : milestone.targetDate ? fmtDate(milestone.targetDate) : milestone.startDate ? fmtDate(milestone.startDate) : "No date"}</span>
            </div>
```

(The list panel keeps its `.milestone-status` pill — it has no colored dot there.)

- [ ] **Step 3: One date per completed card**

Replace the timeline panel's `.roadmap-target` block (inside the summary, from Task 1) with:

```astro
                  <div class="roadmap-target">
                    {milestone.status === "completed"
                      ? milestone.completedDate && <span>Shipped <time datetime={milestone.completedDate}>{fmtDate(milestone.completedDate)}</time></span>
                      : (
                        <>
                          {milestone.startDate && <span>Started <time datetime={milestone.startDate}>{fmtDate(milestone.startDate)}</time></span>}
                          {milestone.targetDate && <span>Target <time datetime={milestone.targetDate}>{fmtDate(milestone.targetDate)}</time></span>}
                        </>
                      )}
                  </div>
```

The list panel's `.roadmap-target` already renders a single `dateLabel(milestone)` — leave it (now humanized via Step 1).

- [ ] **Step 4: Stat tiles say what they count; clearer status line**

Replace the summary tiles markup:

```astro
      <div class="roadmap-summary" aria-label="Roadmap summary">
        <span><strong>{snapshot.milestones.length}</strong> milestones</span>
        <span><strong>{completedMilestones}</strong> completed</span>
        <span><strong>{scheduledCount}</strong> scheduled</span>
      </div>
```

with:

```astro
      <div class="roadmap-summary" aria-label="Roadmap summary">
        <span><strong>{snapshot.milestones.length}</strong> milestones</span>
        <span><strong>{completedMilestones}</strong> delivered</span>
        <span><strong>{scheduledCount}</strong> specs scheduled</span>
      </div>
```

In the script's `render()`, replace the status line assignment:

```js
      const scopeLabel = activeScope === "current" ? "current delivery" : activeScope === "completed" ? "completed history" : "full roadmap";
      const totalGroups = activePanel.querySelectorAll("[data-roadmap-group]").length;
      status.textContent = `Showing ${visibleGroups} of ${totalGroups} milestones · ${scopeLabel}`;
```

- [ ] **Step 5: Narrow the rail column in CSS**

In `global.css`:
- `.roadmap-timeline-node` grid: `grid-template-columns: 158px 38px minmax(0, 1fr);` → `grid-template-columns: 96px 38px minmax(0, 1fr);`
- `.roadmap-legend` margin: `margin: 0 0 14px 186px;` → `margin: 0 0 14px 134px;`
- `.roadmap-timeline-date` keeps its styles; the pill-specific `gap: 7px` can stay (single child now).

- [ ] **Step 6: Build and verify**

`npm run build`, serve, navigate to `?scope=all&view=timeline`. Assert:

```js
() => ({
  railText: document.querySelector('[data-milestone-status="completed"] .roadmap-timeline-date').textContent.trim(), // expect e.g. "Jul 11, 2026", no "COMPLETED" pill text
  cardDates: [...document.querySelectorAll('[data-milestone-status="completed"] .roadmap-target span')].length > 0
    && [...document.querySelectorAll('[data-milestone-status="completed"] .roadmap-target')].every(t => t.querySelectorAll('span').length === 1), // expect true — one date per completed card
  statusLine: document.querySelector('#roadmap-scope-status').textContent, // expect "Showing 8 of 8 milestones · full roadmap"
  thirdTile: document.querySelectorAll('.roadmap-summary span')[2].textContent.trim(), // expect "8 specs scheduled"
})
```

Screenshot `.playwright-mcp/task4-dates.png`. Also check mobile (resize 390×844) — rail column stacks fine. Close the browser.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer/src/pages/roadmap/index.astro packages/renderer/src/styles/global.css
git commit -m "feat(roadmap): humanize dates, slim timeline rail, clarify stat labels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Toolbar — labels, one baseline, view switch out of filters, styled selects, smart Clear

**Files:**
- Modify: `packages/renderer/src/pages/roadmap/index.astro` (toolbar markup ~lines 57–89, overview row ~lines 91–98, script)
- Modify: `packages/renderer/src/styles/global.css` (toolbar rules ~lines 308–378, overview row ~line 380, mobile block)

**Interfaces:**
- Produces: `.roadmap-control` / `.roadmap-control-label` wrapper pattern; `#roadmap-clear` gains a `disabled` state managed by `render()`.
- Consumes: existing `.roadmap-scope-switch`, `.roadmap-view-switch`, `.roadmap-overview-row` styles.

- [ ] **Step 1: Label the scope switch, remove the view switch from the toolbar**

Replace the toolbar's first child:

```astro
      <div class="roadmap-scope-switch" role="group" aria-label="Milestone scope">
```

with:

```astro
      <div class="roadmap-control">
        <span class="roadmap-control-label" id="roadmap-scope-label">Scope</span>
        <div class="roadmap-scope-switch" role="group" aria-labelledby="roadmap-scope-label">
```

(and close the extra `</div>` after the three scope buttons). Then DELETE the whole `.roadmap-view-switch` div from the toolbar and re-insert it in the overview row between the status line and the summary tiles:

```astro
    <div class="roadmap-overview-row">
      <div class="roadmap-scope-status" id="roadmap-scope-status" aria-live="polite"></div>
      <div class="roadmap-view-switch" role="group" aria-label="Roadmap view">
        <button type="button" data-view-button="timeline" aria-pressed="false">Timeline</button>
        <button type="button" data-view-button="list" aria-pressed="false">List</button>
      </div>
      <div class="roadmap-summary" aria-label="Roadmap summary">
```

- [ ] **Step 2: Toolbar CSS — control wrapper, custom select chrome, disabled Clear**

In `global.css` after the `.roadmap-toolbar label { ... }` rule add:

```css
.roadmap-control { display: grid; gap: 4px; }
.roadmap-control-label {
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
```

Extend the select/input rule — change:

```css
.roadmap-toolbar select,
.roadmap-toolbar input {
```

so that below its existing declarations, selects get custom chrome. Add after that rule block:

```css
.roadmap-toolbar select {
  padding-right: 30px;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%237d8c9e' stroke-width='1.6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
}

.roadmap-clear[disabled] { opacity: 0.45; cursor: default; }
.roadmap-clear[disabled]:hover { color: var(--text-muted); background: var(--bg); }
```

Change `.roadmap-overview-row` from `justify-content: space-between;` to a flex row with the status line flexing:

```css
.roadmap-overview-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 18px;
}

.roadmap-scope-status { flex: 1; }
```

(`.roadmap-scope-status` keeps its existing color/font declarations — add `flex: 1;` to that existing rule instead of a duplicate selector if preferred.)

In the mobile media block, `.roadmap-overview-row { display: block; }` already exists; change the existing `.roadmap-view-switch { margin-left: 0; }` rule inside that media query to `.roadmap-view-switch { margin: 12px 0 0; }` so the switch doesn't hug the status text on small screens.

- [ ] **Step 3: Script — disable Clear when nothing to clear**

In the script, after `const empty = document.querySelector("#roadmap-filter-empty");` add:

```js
    const clearButton = document.querySelector("#roadmap-clear");
```

In `render()`, before `updateUrl();`, add:

```js
      clearButton.disabled = activeScope === "current" && !milestoneSelect.value && !stateSelect.value && !search.value.trim();
```

Change the existing clear-button listener registration to use the variable: `clearButton.addEventListener("click", () => { ... })` (body unchanged).

- [ ] **Step 4: Build and verify**

`npm run build`, serve, navigate to `http://localhost:4173/roadmap/`. Assert:

```js
() => ({
  clearDisabled: document.querySelector('#roadmap-clear').disabled,            // expect true on default landing
  viewSwitchInToolbar: !!document.querySelector('.roadmap-toolbar .roadmap-view-switch'), // expect false
  viewSwitchInOverview: !!document.querySelector('.roadmap-overview-row .roadmap-view-switch'), // expect true
  scopeLabeled: document.querySelector('#roadmap-scope-label').textContent,    // expect "Scope"
})
```

Click "All" scope → Clear must become enabled; click Clear → back to disabled, scope=current. Screenshot `.playwright-mcp/task5-toolbar.png` (check the single baseline). Close the browser.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/pages/roadmap/index.astro packages/renderer/src/styles/global.css
git commit -m "feat(roadmap): toolbar cleanup — labeled scope control, relocated view switch, styled selects, smart clear

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Typography identity, version-chip fix, favicon

**Files:**
- Modify: `assets/style.css` (`:root` tokens ~line 46, heading rules)
- Modify: `packages/renderer/src/pages/roadmap/index.astro` (remove `<code>{milestone.id}</code>` chips, both panels)
- Modify: `packages/renderer/src/layouts/BaseLayout.astro` (favicon link)

**Interfaces:**
- Produces: `--font-display` token (aliases the mono stack) applied to all `h1`, roadmap milestone `h2`, and stat numbers.
- Consumes: `.overview-value` (dashboard tiles), `.roadmap-summary strong` (roadmap tiles).

- [ ] **Step 1: Display typography token and application**

In `assets/style.css` `:root`, after the `--font-mono` line, add:

```css
  --font-display: var(--font-mono);
```

After the `html, body { ... }` rule add:

```css
h1 {
  font-family: var(--font-display);
  letter-spacing: -0.02em;
}
```

In `packages/renderer/src/styles/global.css`, extend the milestone title and stat number rules — change `.roadmap-milestone-title .roadmap-milestone-name { margin: 0; font-size: 20px; }` (the title is a `<strong class="roadmap-milestone-name">` since the Task 1 validity fix) to:

```css
.roadmap-milestone-title .roadmap-milestone-name { margin: 0; font-family: var(--font-display); font-size: 19px; letter-spacing: -0.01em; }
```

and `.roadmap-summary strong { color: var(--text); font-size: 20px; line-height: 1.1; }` to:

```css
.roadmap-summary strong { color: var(--text); font-family: var(--font-display); font-variant-numeric: tabular-nums; font-size: 20px; line-height: 1.1; }
```

In `global.css`, change `.overview-value { font-size: 24px; font-weight: 750; line-height: 1; }` to:

```css
.overview-value { font-family: var(--font-display); font-variant-numeric: tabular-nums; font-size: 24px; font-weight: 750; line-height: 1; }
```

- [ ] **Step 2: Remove the slug chips**

In `roadmap/index.astro`, delete the line `<code>{milestone.id}</code>` from the timeline panel's `.roadmap-milestone-title` and the same line from the list panel's `.roadmap-milestone-title`. (The id remains available as `data-milestone` and in the milestone filter dropdown.)

- [ ] **Step 3: Favicon**

In `BaseLayout.astro` `<head>`, after the `<meta name="generator" ...>` line, add:

```html
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%23090d12'/%3E%3Cpath d='M4.5 4.5l4 3.5-4 3.5' fill='none' stroke='%23fbbf24' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M9.5 12h3' stroke='%23fb7185' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E" />
```

(a terminal prompt `❯_` in gold + rose on the app's ink background — matches the brand without any file dependency).

- [ ] **Step 4: Build and verify**

`npm run build`, serve, check `http://localhost:4173/roadmap/?scope=all`:

```js
() => ({
  h1Mono: getComputedStyle(document.querySelector('main h1')).fontFamily.includes('mono'),     // expect true
  msTitleMono: getComputedStyle(document.querySelector('.roadmap-milestone-title .roadmap-milestone-name')).fontFamily.includes('mono'), // expect true
  chipGone: !document.querySelector('.roadmap-milestone-title > code'),                        // expect true
  favicon: !!document.querySelector('link[rel="icon"]'),                                       // expect true
})
```

Confirm no favicon 404 in the console log. Visit the dashboard home too — stat numbers render mono/tabular. Full-page screenshots `.playwright-mcp/task6-typography.png` and `.playwright-mcp/task6-home.png`; eyeball the mono headings across pages (site wordmark, Roadmap h1, spec detail h1). Close the browser.

- [ ] **Step 5: Commit**

```bash
git add assets/style.css packages/renderer/src/styles/global.css packages/renderer/src/pages/roadmap/index.astro packages/renderer/src/layouts/BaseLayout.astro
git commit -m "feat(design): mono display typography, drop slug chips, add favicon

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Full-page review pass and core test suite

**Files:**
- No new files; possible small fix-ups from findings.

- [ ] **Step 1: Run the existing test suites**

Run: `npm test`
Expected: core + mcp suites pass (renderer has no unit tests; this guards the shared packages weren't touched accidentally).

- [ ] **Step 2: Full visual sweep**

Build + serve, then with Playwright walk: `/` (home), `/roadmap/` (default), `/roadmap/?scope=all&view=timeline`, `/roadmap/?scope=all&view=list`, `/roadmap/?scope=completed`, a spec detail page, `/graph/`, `/health/` — at 1440×900 and 390×844. Verify: no layout breaks, no console errors, collapsed/expanded states behave, filters + Clear + view switch work, URL params round-trip (`?state=shipped` opens collapsed details). Save screenshots under `.playwright-mcp/final-*.png`. Close the browser.

- [ ] **Step 3: Update the design review doc**

In `docs/DESIGN_REVIEW_ROADMAP.md`, append a short "Implemented 2026-07-14" section listing which findings shipped (P0-1, P0-2, P0-3, P1-4, P1-5, P1-6, P2-7 partial — mono identity via system mono stack, P2-8) and which were deliberately skipped (stat tiles stay global — labeled instead; legend position unchanged).

- [ ] **Step 4: Commit**

```bash
git add docs/DESIGN_REVIEW_ROADMAP.md
git commit -m "docs: record implemented roadmap design improvements

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

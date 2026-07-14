# Roadmap Time Range Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a preset time-range select to the roadmap toolbar that filters milestone groups by interval overlap with a window computed from today's date.

**Architecture:** All changes live in one file, `packages/renderer/src/pages/roadmap/index.astro`. Build-time frontmatter emits each milestone's date interval as `data-date-start`/`data-date-end` attributes on the existing `data-roadmap-group` elements; the page's inline client script gains a `#roadmap-range` select wired into the existing `filterGroup()`/`render()`/`updateUrl()` machinery. No core, MCP, CLI, or CSS changes.

**Tech Stack:** Astro 7 static page, vanilla inline JS, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-15-roadmap-time-range-filter-design.md`

## Global Constraints

- Static output stays dependency-free: no external scripts, no new packages.
- Select id is exactly `roadmap-range`; URL param is exactly `range`; values are exactly `30d`, `90d`, `1y`, `next90d`, `year` (empty string = All time, omitted from URL).
- Option labels in order: `All time`, `Last 30 days`, `Last 90 days`, `Last year`, `Next 90 days`, `This year`.
- Matching is interval overlap: group matches window `[winStart, winEnd]` iff `dateStart <= winEnd && dateEnd >= winStart`, comparing ISO `YYYY-MM-DD` strings lexicographically.
- `data-date-start` = `startDate ?? completedDate ?? targetDate`; `data-date-end` = `completedDate ?? targetDate ?? startDate`.
- Groups without dates (the `next-release` milestone, the synthetic "Unscheduled work" group) get NO date attributes and match only All time.
- Window boundaries use the browser's local date (`getFullYear`/`getMonth`/`getDate`), never `toISOString()` (UTC would shift the day near midnight).
- The renderer package has no unit-test harness; each task verifies via build-output assertions, and Task 3 verifies end-to-end. `npm test --workspaces` (core 7, mcp 5) must stay green.
- `npx --yes html-validate dist/roadmap/index.html` currently reports 35 findings on main; the count must not grow.
- Follow the file's existing code style: semicolons, double quotes, existing helper naming.

---

### Task 1: Emit milestone date intervals as data attributes

**Files:**
- Modify: `packages/renderer/src/pages/roadmap/index.astro` (frontmatter `milestoneGroups` map ~line 12; timeline panel group element ~line 130; list panel group element ~line 198)

**Interfaces:**
- Produces: `data-date-start` / `data-date-end` attributes on every dated `[data-roadmap-group]` element in BOTH panels, read by Task 2's client script as `group.dataset.dateStart` / `group.dataset.dateEnd`.

- [ ] **Step 1: Add interval fields to `milestoneGroups`**

In the frontmatter, the `milestoneGroups` map currently returns:

```js
  return {
    ...milestone,
    specs,
    shipped,
    progress: specs.length ? Math.round((shipped / specs.length) * 100) : 0,
  };
```

Change it to:

```js
  return {
    ...milestone,
    specs,
    shipped,
    progress: specs.length ? Math.round((shipped / specs.length) * 100) : 0,
    dateStart: milestone.startDate ?? milestone.completedDate ?? milestone.targetDate,
    dateEnd: milestone.completedDate ?? milestone.targetDate ?? milestone.startDate,
  };
```

Do NOT add `dateStart`/`dateEnd` to `unscheduledGroup` — its absence is the design: undefined values make Astro omit the attributes entirely.

- [ ] **Step 2: Emit the attributes in the timeline panel**

The timeline panel's group element (`<article class="roadmap-timeline-node" …>`) currently carries:

```astro
            data-roadmap-group
            data-milestone={milestone.id}
            data-milestone-status={milestone.status}
            data-search={searchText(milestone)}
```

Add the two date attributes after `data-milestone-status`:

```astro
            data-roadmap-group
            data-milestone={milestone.id}
            data-milestone-status={milestone.status}
            data-date-start={milestone.dateStart}
            data-date-end={milestone.dateEnd}
            data-search={searchText(milestone)}
```

- [ ] **Step 3: Emit the attributes in the list panel**

The list panel's group element (`<details class:list={["roadmap-milestone", …]} …>`) carries the same attribute set (~line 198). Add the identical two lines after its `data-milestone-status={milestone.status}` line:

```astro
            data-date-start={milestone.dateStart}
            data-date-end={milestone.dateEnd}
```

- [ ] **Step 4: Build and verify the emitted HTML**

Run from the repo root:

```bash
npm run build
grep -c 'data-date-start="2026-05-12"' dist/roadmap/index.html
```

Expected: `2` (v0-1-0 in the timeline panel and the list panel).

```bash
grep -o 'data-milestone="next-release"[^>]*' dist/roadmap/index.html | grep -c 'data-date-start'
```

Expected: `0` (undated milestone gets no date attributes; note `grep -c` exits 1 when the count is 0 — that exit code is the expected result here, not a failure).

```bash
grep -o 'data-milestone="v0-7-0"[^>]*data-date-end="[^"]*"' dist/roadmap/index.html | head -1
```

Expected: a match containing `data-date-start="2026-07-14"` and `data-date-end="2026-07-14"` (v0-7-0 has `startDate`+`completedDate` both 2026-07-14).

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/pages/roadmap/index.astro
git commit -m "Emit milestone date intervals on roadmap groups"
```

---

### Task 2: Add the Time range control and filter logic

**Files:**
- Modify: `packages/renderer/src/pages/roadmap/index.astro` (toolbar ~line 85–96; inline `<script>` ~line 253–360)

**Interfaces:**
- Consumes: `group.dataset.dateStart` / `group.dataset.dateEnd` from Task 1.
- Produces: `#roadmap-range` select; `?range=` URL param; range-aware `filterGroup()`.

- [ ] **Step 1: Add the select to the toolbar**

Between the "Work state" `</label>` and the `<label class="roadmap-search-control">` insert:

```astro
      <label>Time range
        <select id="roadmap-range">
          <option value="">All time</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="1y">Last year</option>
          <option value="next90d">Next 90 days</option>
          <option value="year">This year</option>
        </select>
      </label>
```

No CSS changes: `.roadmap-toolbar label` and `.roadmap-toolbar select` already style it (global.css lines ~321/353), including the mobile stacking rules (~line 708).

- [ ] **Step 2: Declare, validate, and initialize in the script**

After the existing line `const validViews = new Set(["timeline", "list"]);` add:

```js
    const validRanges = new Set(["30d", "90d", "1y", "next90d", "year"]);
```

After the existing line `const search = document.querySelector("#roadmap-search");` add:

```js
    const rangeSelect = document.querySelector("#roadmap-range");
```

After the existing line `search.value = params.get("q") || "";` add:

```js
    rangeSelect.value = validRanges.has(params.get("range")) ? params.get("range") : "";
```

(`params.get` returns `null` when absent; `validRanges.has(null)` is false, so absence and garbage both fall back to All time.)

- [ ] **Step 3: Add window computation helpers**

Immediately after the `rangeSelect.value = …` line from Step 2, add:

```js
    let activeRange = null;

    function isoDate(date) {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function shiftDays(days) {
      const date = new Date();
      date.setDate(date.getDate() + days);
      return isoDate(date);
    }

    function rangeWindow() {
      const today = isoDate(new Date());
      switch (rangeSelect.value) {
        case "30d": return [shiftDays(-30), today];
        case "90d": return [shiftDays(-90), today];
        case "1y": return [shiftDays(-365), today];
        case "next90d": return [today, shiftDays(90)];
        case "year": return [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`];
        default: return null;
      }
    }
```

- [ ] **Step 4: Wire the range into `updateUrl()`**

After the existing line `if (stateSelect.value) next.set("state", stateSelect.value);` add:

```js
      if (rangeSelect.value) next.set("range", rangeSelect.value);
```

- [ ] **Step 5: Wire the range into `filterGroup()`**

After the existing line `const scopeMatches = groupMatchesScope(group);` add:

```js
      const rangeMatches = !activeRange || Boolean(
        group.dataset.dateStart
        && group.dataset.dateStart <= activeRange[1]
        && group.dataset.dateEnd >= activeRange[0]
      );
```

Then change the visibility line from:

```js
      group.hidden = !(milestoneMatches && scopeMatches && workMatches);
```

to:

```js
      group.hidden = !(milestoneMatches && scopeMatches && rangeMatches && workMatches);
```

- [ ] **Step 6: Refresh the window once per render and extend Clear**

Add as the FIRST line inside `render()`:

```js
      activeRange = rangeWindow();
```

Change the clear-button disabled line from:

```js
      clearButton.disabled = activeScope === "current" && !milestoneSelect.value && !stateSelect.value && !search.value.trim();
```

to:

```js
      clearButton.disabled = activeScope === "current" && !milestoneSelect.value && !stateSelect.value && !rangeSelect.value && !search.value.trim();
```

After the existing listener line `stateSelect.addEventListener("change", render);` add:

```js
    rangeSelect.addEventListener("change", render);
```

Inside the `clearButton` click handler, after `stateSelect.value = "";` add:

```js
      rangeSelect.value = "";
```

- [ ] **Step 7: Build and verify the emitted page**

```bash
npm run build
grep -c 'id="roadmap-range"' dist/roadmap/index.html
```

Expected: `1`.

```bash
grep -o '<option value="next90d">[^<]*' dist/roadmap/index.html
```

Expected: `<option value="next90d">Next 90 days`.

```bash
grep -c 'rangeMatches' dist/roadmap/index.html
```

Expected: `0` with exit code 1 — Astro bundles the script into `dist/_astro/`, it must not be inlined twice. Then confirm the bundled script contains the logic:

```bash
grep -rl 'roadmap-range' dist/_astro/*.js | head -1
```

Expected: one bundle path. (If the project inlines scripts instead and `rangeMatches` appears in the HTML, that is also fine — the point is the logic ships exactly once; adjust the assertion to wherever the existing `filterGroup` logic landed.)

- [ ] **Step 8: Commit**

```bash
git add packages/renderer/src/pages/roadmap/index.astro
git commit -m "Add time range filter to roadmap toolbar"
```

---

### Task 3: End-to-end verification

**Files:**
- No source changes expected; fixes discovered here are amended into the Task 1/2 code paths.

**Interfaces:**
- Consumes: the built `dist/` from Tasks 1–2.

Sample-data expectations below assume execution between 2026-07-15 and 2026-08-10 (they depend on "today"; v0-1-0's `completedDate` 2026-07-11 leaves the Last-30-days window on 2026-08-11). If run later, recompute expected sets from `specdash.config.yaml` dates before asserting. Current data: 7 completed milestones with dates 2026-05-12 → 2026-07-14, one undated planned milestone `next-release`, plus the "Unscheduled work" group if any specs are unassigned.

- [ ] **Step 1: Serve the built site**

```bash
npm run build
python3 -m http.server 4173 --directory dist &
```

- [ ] **Step 2: Playwright checks — presets**

Using Playwright MCP (outputs under `.playwright-mcp/` in the project root, NEVER /tmp), navigate to `http://localhost:4173/roadmap/?scope=all` and for each assertion read the status line `#roadmap-scope-status` and visible groups:

1. Default (All time): all groups visible, status reads "Showing N of N milestones".
2. Select "Last 30 days": exactly the 7 dated milestone groups visible; `next-release` and "Unscheduled work" hidden; URL contains `range=30d`.
3. Select "Next 90 days": zero groups visible; the `#roadmap-filter-empty` message is shown (no sample milestone has a date ≥ today).
4. Select "This year": 7 dated groups visible.
5. Click "Clear filters": select returns to All time, `range` param dropped from URL, scope resets to Current.

- [ ] **Step 3: Playwright checks — round-trip, views, composition, mobile**

1. Load `http://localhost:4173/roadmap/?scope=all&range=90d` directly: select shows "Last 90 days" and only dated groups are visible (no flash-of-everything concerns — filtering runs before first paint completes is not required, matching existing filters' behavior).
2. Load with `?range=bogus`: select shows "All time", no JS errors in console.
3. Switch to List view with a range active: identical visible-group set.
4. Combine `range=30d` with Work state `shipped`: only dated groups that ALSO contain shipped specs remain (AND-composition).
5. Resize to 390×844: toolbar wraps without horizontal overflow; screenshot to `.playwright-mcp/`.
6. Check the browser console for errors (warnings about font preload are a known pre-existing false positive).
7. `browser_close` when done.

- [ ] **Step 4: Regression gates**

```bash
npx --yes html-validate dist/roadmap/index.html 2>&1 | tail -3
```

Expected: no more than 35 findings (pre-existing baseline).

```bash
npm test --workspaces
```

Expected: core 7/7, mcp 5/5 pass.

```bash
kill $(lsof -t -i:4173)
```

- [ ] **Step 5: Commit any fixes**

If Steps 2–4 surfaced fixes, amend them into the relevant code with a follow-up commit:

```bash
git add -A && git commit -m "Fix roadmap range filter issues found in verification"
```

Otherwise no commit — verification produced no changes.

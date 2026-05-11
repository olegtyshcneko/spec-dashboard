// Spec Dashboard — index page logic
// Reads window.SPECS (set by data.js) and renders filters + status tabs + list.
// Pure DOM. No build step.

(function () {
  "use strict";

  const SECTIONS = [
    { key: "wip",          title: "In Progress" },
    { key: "implemented",  title: "Implemented" },
    { key: "backlog",      title: "Backlog" },
    { key: "nice-to-have", title: "Nice to have" },
    { key: "known-issue",  title: "Known Issues" },
  ];

  // Order used when the "All" tab is active. Tab order above stays UI-stable;
  // this controls how rows are grouped vertically in the list.
  const ALL_TAB_STATUS_ORDER = [
    "wip",
    "nice-to-have",
    "known-issue",
    "backlog",
    "implemented",
  ];
  const ALL_TAB_STATUS_RANK = Object.fromEntries(
    ALL_TAB_STATUS_ORDER.map((s, i) => [s, i])
  );

  const ROOT = document.getElementById("dash-root");
  if (!ROOT) return;

  const specs = (window.SPECS || []).slice();
  const allTags = Array.from(new Set(specs.flatMap(s => s.tags || []))).sort();

  // State — activeStatus null = "All" tab
  let q = "";
  let activeTag = null;
  let activeStatus = null;

  // ---- DOM helpers ----
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(x => node.appendChild(x instanceof Node ? x : document.createTextNode(String(x))));
      else node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function fmtDate(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const days = Math.round((Date.now() - d.getTime()) / 86400000);
      if (days < 1) return "today";
      if (days < 2) return "yesterday";
      if (days < 14) return days + "d ago";
      if (days < 60) return Math.round(days / 7) + "w ago";
      return iso;
    } catch (_) { return iso; }
  }

  function statusLabel(s) {
    return SECTIONS.find(x => x.key === s)?.title || s;
  }

  // ---- Filtering ----
  // baseMatches: text + tag (ignores status — used for tab counts and "All" tab)
  function baseMatches(spec) {
    if (activeTag && !(spec.tags || []).includes(activeTag)) return false;
    if (q) {
      const hay = (spec.title + " " + (spec.summary || "") + " " + (spec.tags || []).join(" ")).toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }
  function matches(spec) {
    if (activeStatus && spec.status !== activeStatus) return false;
    return baseMatches(spec);
  }

  // ---- Render: filter bar (search + tag chips + clear) ----
  function renderFilters() {
    const searchInput = el("input", {
      type: "search",
      placeholder: "Search title, summary, or tag…",
      "aria-label": "Search specs",
      value: q,
      oninput: (e) => { q = e.target.value; renderAll(); },
    });
    const tagChips = el("div", { class: "filter-chips", "aria-label": "Filter by tag" });
    allTags.forEach(t => {
      const c = el("button", {
        type: "button",
        class: "chip" + (activeTag === t ? " is-active" : ""),
        onclick: () => { activeTag = activeTag === t ? null : t; renderAll(); },
      }, "#" + t);
      tagChips.appendChild(c);
    });
    const clearBtn = el("button", {
      type: "button",
      class: "chip",
      onclick: () => { q = ""; activeTag = null; activeStatus = null; renderAll(); },
    }, "clear");
    return el("div", { class: "filters" }, searchInput, tagChips, clearBtn);
  }

  // ---- Render: status tabs (replaces the old stacked status sections) ----
  function renderTabs() {
    const tabs = el("div", { class: "status-tabs", role: "tablist" });
    const baseFiltered = specs.filter(baseMatches);

    function makeTab(key, label, count) {
      const active = key == null ? activeStatus == null : activeStatus === key;
      return el("button", {
        type: "button",
        role: "tab",
        "aria-selected": active ? "true" : "false",
        class: "status-tab" + (active ? " is-active" : ""),
        onclick: () => { activeStatus = key; renderAll(); },
      },
        label,
        el("span", { class: "tab-count" }, String(count))
      );
    }

    tabs.appendChild(makeTab(null, "All", baseFiltered.length));
    for (const s of SECTIONS) {
      const count = baseFiltered.filter(x => x.status === s.key).length;
      tabs.appendChild(makeTab(s.key, s.title, count));
    }
    return tabs;
  }

  // ---- Render: list row (replaces the old card) ----
  function renderRow(spec) {
    return el("a", { class: "spec-row", href: spec.href },
      el("span", { class: "pill", "data-status": spec.status }, statusLabel(spec.status)),
      el("div", { class: "spec-row-body" },
        el("div", { class: "spec-row-title" }, spec.title),
        spec.summary ? el("div", { class: "spec-row-summary" }, spec.summary) : null,
      ),
      el("div", { class: "spec-row-meta" },
        spec.priority ? el("span", { class: "prio", "data-prio": spec.priority, title: "Priority " + spec.priority.toUpperCase() }) : null,
        ...(spec.tags || []).slice(0, 3).map(t => el("span", { class: "tag" }, "#" + t)),
        el("span", { class: "when" }, fmtDate(spec.updated)),
      )
    );
  }

  function renderList() {
    let items = specs.filter(matches);
    if (!items.length) {
      return el("p", { class: "empty" }, "No specs match the current filters.");
    }
    if (activeStatus == null) {
      // "All" view groups by the custom status order, recent first within each group.
      items = items.slice().sort((a, b) => {
        const ra = ALL_TAB_STATUS_RANK[a.status] ?? 99;
        const rb = ALL_TAB_STATUS_RANK[b.status] ?? 99;
        if (ra !== rb) return ra - rb;
        return (b.updated || "").localeCompare(a.updated || "");
      });
    }
    return el("div", { class: "spec-list" }, ...items.map(renderRow));
  }

  function renderCounter() {
    const node = document.getElementById("dash-counter");
    if (!node) return;
    const total = specs.length;
    const visible = specs.filter(matches).length;
    node.textContent = (visible === total)
      ? total + " specs"
      : visible + " of " + total + " specs";
  }

  function renderAll() {
    ROOT.innerHTML = "";
    ROOT.appendChild(renderFilters());
    ROOT.appendChild(renderTabs());
    ROOT.appendChild(renderList());
    renderCounter();
  }

  renderAll();
})();

// Przypadky Feature Dashboard — index page logic
// Reads window.SPECS (set by data.js) and renders sections + filters.
// Pure DOM. No build step. Works on file://

(function () {
  "use strict";

  const SECTIONS = [
    { key: "wip",          title: "In Progress",  blurb: "Actively being built or smoke-tested." },
    { key: "implemented",  title: "Implemented",  blurb: "Shipped on staging or main; covered by tests." },
    { key: "backlog",      title: "Backlog",      blurb: "Planned but not started." },
    { key: "nice-to-have", title: "Nice to have", blurb: "Would be cool — not blocking anything." },
    { key: "known-issue",  title: "Known Issues", blurb: "Bugs or gaps we know about." },
  ];

  const ROOT = document.getElementById("dash-root");
  if (!ROOT) return;

  const specs = (window.SPECS || []).slice();
  const allTags = Array.from(new Set(specs.flatMap(s => s.tags || []))).sort();

  // State
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
        else if (k.startsWith("data-")) node.setAttribute(k, v);
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

  // ---- Filtering ----
  function matches(spec) {
    if (activeStatus && spec.status !== activeStatus) return false;
    if (activeTag && !(spec.tags || []).includes(activeTag)) return false;
    if (q) {
      const hay = (
        spec.title + " " +
        (spec.summary || "") + " " +
        (spec.tags || []).join(" ")
      ).toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }

  // ---- Render: filter bar ----
  function renderFilters() {
    const searchInput = el("input", {
      type: "search",
      placeholder: "Search title, summary, or tag…",
      "aria-label": "Search specs",
      value: q,
      oninput: (e) => { q = e.target.value; renderAll(); },
    });
    const statusChips = el("div", { class: "filter-chips", "aria-label": "Filter by status" });
    SECTIONS.forEach(s => {
      const c = el("button", {
        type: "button",
        class: "chip" + (activeStatus === s.key ? " is-active" : ""),
        onclick: () => { activeStatus = activeStatus === s.key ? null : s.key; renderAll(); },
      }, s.title);
      statusChips.appendChild(c);
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
    return el("div", { class: "filters" }, searchInput, statusChips, tagChips, clearBtn);
  }

  // ---- Render: recently updated rail ----
  function renderRail() {
    const recent = specs.slice().sort((a, b) => (b.updated || "").localeCompare(a.updated || "")).slice(0, 5);
    const list = el("ul", { class: "rail-list" },
      ...recent.map(s => el("li", null,
        el("a", { href: s.href },
          el("span", null, s.title),
          el("span", { class: "when" }, fmtDate(s.updated))
        )
      ))
    );
    return el("section", { class: "rail" },
      el("h2", null, "Recently updated"),
      list
    );
  }

  // ---- Render: card ----
  function renderCard(spec) {
    return el("article", { class: "card" },
      el("div", { class: "card-top" },
        el("span", { class: "pill", "data-status": spec.status }, statusLabel(spec.status)),
        spec.priority ? el("span", { class: "prio", "data-prio": spec.priority, title: "Priority " + spec.priority.toUpperCase() }) : null
      ),
      el("h3", null, el("a", { href: spec.href }, spec.title)),
      el("p", null, spec.summary || ""),
      el("div", { class: "card-meta" },
        el("div", { class: "card-tags" }, ...(spec.tags || []).map(t => el("span", { class: "tag" }, "#" + t))),
        el("span", null, fmtDate(spec.updated))
      )
    );
  }

  function statusLabel(s) {
    return SECTIONS.find(x => x.key === s)?.title || s;
  }

  // ---- Render: section ----
  function renderSection(section, items) {
    const head = el("div", { class: "section-head" },
      el("h2", null, section.title),
      el("span", { class: "count" }, items.length + " " + (items.length === 1 ? "spec" : "specs")),
      el("span", { class: "blurb" }, section.blurb),
    );
    const body = items.length
      ? el("div", { class: "card-grid" }, ...items.map(renderCard))
      : el("p", { class: "empty" }, "Nothing here yet.");
    return el("section", { class: "section", "data-section": section.key }, head, body);
  }

  // ---- Render: total counter under header subtitle ----
  function renderCounter() {
    const node = document.getElementById("dash-counter");
    if (!node) return;
    const total = specs.length;
    const visible = specs.filter(matches).length;
    node.textContent = (visible === total)
      ? total + " specs"
      : visible + " of " + total + " specs";
  }

  // ---- Top-level render ----
  function renderAll() {
    ROOT.innerHTML = "";
    ROOT.appendChild(renderFilters());
    ROOT.appendChild(renderRail());
    for (const s of SECTIONS) {
      const items = specs.filter(x => x.status === s.key).filter(matches);
      // Skip whole section if user actively filtered to a different status
      if (activeStatus && activeStatus !== s.key) continue;
      ROOT.appendChild(renderSection(s, items));
    }
    renderCounter();
  }

  renderAll();
})();

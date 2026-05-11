// Manifest of every spec page. Edit this when adding/removing/updating a spec.
// Field reference:
//   slug      — kebab-case identifier, must match specs/<slug>.html
//   title     — short, plain-language name
//   status    — implemented | wip | backlog | nice-to-have | known-issue
//   priority  — p0 (must) | p1 (should) | p2 (could)
//   summary   — 1-2 sentence elevator pitch shown on the card
//   tags      — bounded taxonomy; keep the set small for filterability
//   updated   — ISO date of last meaningful change (YYYY-MM-DD)
//   href      — path to the detail page from index.html
//
// The index sorts the "Recently updated" rail by `updated` descending.
// Bump the date whenever the spec or its underlying code changes substantially.
//
// Status taxonomy lives in assets/dashboard.js (SECTIONS array). Change it
// there if your project needs different status buckets.

window.SPECS = [
  { slug: "example-shipped",        title: "Example: shipped feature",     status: "implemented", priority: "p0", summary: "What a finished, in-production feature spec looks like. Cards in this state record acceptance criteria after the fact and act as living documentation.",                tags: ["example", "docs"],         updated: "2026-05-11", href: "specs/example-shipped.html" },
  { slug: "example-active",         title: "Example: active work",         status: "wip",         priority: "p0", summary: "What an in-progress spec looks like. Use these to record what you're actively building and the decisions you've already locked in.",                                     tags: ["example"],                  updated: "2026-05-11", href: "specs/example-active.html" },
  { slug: "example-backlog",        title: "Example: planned feature",     status: "backlog",     priority: "p1", summary: "What a planned-but-not-started feature looks like. Useful for getting alignment on a future feature's shape before anyone writes code.",                                tags: ["example"],                  updated: "2026-05-11", href: "specs/example-backlog.html" },
  { slug: "example-nice-to-have",   title: "Example: nice-to-have idea",   status: "nice-to-have",priority: "p2", summary: "What a low-priority idea looks like. Capture these so they don't get lost, but don't let them crowd out the work that actually matters.",                              tags: ["example"],                  updated: "2026-05-11", href: "specs/example-nice-to-have.html" },
  { slug: "example-known-issue",    title: "Example: known issue",         status: "known-issue", priority: "p1", summary: "What a documented bug or limitation looks like. Track these alongside features so the gap between intent and reality stays visible.",                                  tags: ["example", "bug"],          updated: "2026-05-11", href: "specs/example-known-issue.html" },
];

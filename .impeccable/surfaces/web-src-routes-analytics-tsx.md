---
version: 1
slug: "web-src-routes-analytics-tsx"
primary_target: "web/src/routes/analytics.tsx"
related_targets: []
---

# Kickback dashboard (`/` Today, `/decide` Decide)

Mode: Operate. Two people (owner + co-author) at a desk, phone glances after a notification. Jobs: check earnings, maintain the catalog (Today); decide what to build (Decide). Constraints: pending/unknown/untracked states stay visible; auto-withdraw and notifications are real actions; no Railway train logo or wordmark; "Next" states only verifiable facts (stale collector, health <50, below support bonus, behind on upgrades, copies; build items only from shortlisted candidates).

## Direction contract

THESIS: Dispatcher run as a dispatch office's docket book: what is held comes first, then today's takings, then every template as a consignment row. Refuses the KPI-card grid with a chart hero.

OWN-WORLD: Docket paper ground (#F6F4EE), carbon tray (#E8E1CF), navy ink (#1D2433) for the top bar, text and 1px rules; held red (#B23A2E) only on things that need you; running green (#2D6A4F); one action blue only on what can be pressed. IBM Plex Sans Condensed for words, IBM Plex Mono for every figure and template code. Square corners, hairline-boxed cells, no cards, no shadows. Dark theme is the carbon copy: navy ground, paper ink.

STORY: One glance answers: is anything held, what came in today, what the balance is and whether auto-withdraw will pay it. Then press a held name to jump to its consignment, or open Decide.

FIRST VIEWPORT: Navy bar (Dispatcher, Today / Decide / Payouts, sampled time, refresh, notifications, auto-withdraw, user). Docket header: four hairline cells (Today, Last N days with delta, Balance with auto-withdraw state, Templates with active projects), mono figures ~34px. Carbon "Held" tray naming each held template inline with its reason, plus a Next line. Below: earnings chart, upgrades, consignment table.

FORM: Dispatch Docket, #1 on my second grounded list (IMPECCABLE'S PICK, chosen by the user), seed key e07578ba, re-roll 1. Signature interaction: a held name jumps to its consignment row and marks it with a held rule that stays until another is chosen. Motion: that mark settles in once, exponential ease-out.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

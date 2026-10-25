# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Two people: the repo owner and their co-author, who publish and maintain a catalog of Railway templates and earn Railway's template kickback from it. Dispatcher watches the one Railway workspace that owns its project. Nobody else deploys or logs into it.

## Product Purpose
Dispatcher runs the template catalog as a business. A session does one or more of three jobs:

- **Check earnings:** what kickback did, whether payouts landed, which template earned each one, whether anything broke.
- **Decide what to build:** Candidates (what people deploy on Railway against what we already publish) and What to publish (kind, size and age against earnings and time to first payout) pick the next template.
- **Maintain the catalog:** the upgrade queue, template-health drops and broken deploys flag templates that fell behind or failed.

Success means more kickback for less maintenance: the next template gets picked on evidence, a regression gets caught before it costs deploys, and money never goes unnoticed.

## Positioning
It answers questions Railway's own template metrics cannot. It attributes each kickback payout to the template that earned it (hourly earnings snapshots, partition matching), keeps history Railway does not, explains Railway's overloaded counts ("Deployments", "Projects", "Active projects", "Running"), and ties earnings to decisions about what to build and what to fix.

## Operating Context
- Mostly desktop sessions working through tables and charts. Quick phone checks matter too, usually after a notification (payout request, health drop, weekly summary via Discord, Slack, ntfy or webhook), so the key numbers have to read on a phone.
- `dispatcherctl` gives agents and scripts the same data as JSON over the same Railway OAuth session. The web UI is the main surface for people; the CLI is a peer, not an afterthought.
- Hosted on Railway behind its CDN, as a single Go binary with an embedded React Router SPA and DuckDB. Single process.
- Login is Railway OAuth only. Railway stays the authority on who you are.

## Capabilities and Constraints
- Three routes under one navy bar: `/` Today (docket of today, the range, balance and catalog; the Held tray with its Next line; Earnings; Templates with the upgrade queue, reach vs money and the funnel), `/decide` (What to publish, Candidates, copies of our templates) and `/payouts` (cash and credits, history). The range rides in `?days`. Dialogs for auto-withdraw and notification targets live in the bar.
- Data comes from Railway's GraphQL API, sampled hourly. Payouts from before tracking began are `untracked`, unexplained ones are `pending` and then `unknown`, and cash withdrawals are never attributed. Those states are facts the UI must show, not hide.
- Range is selectable in days. Metrics depend on Railway's definitions, which the UI explains where they appear.
- Daily auto-withdraw and notification delivery are real money and messaging actions.

## Brand Commitments
Name: **Dispatcher**. Voice: concise, technical, plain. Copy explains what a number means and what to do about it (see the dashboard's section descriptions). Must not use Railway's train logo or wordmark.

## Evidence on Hand
Live workspace data via Railway (earnings, payouts, templates, deploys). No users, testimonials or public claims exist or are needed. It is a private tool.

## Product Principles
1. **Decisions over decoration.** Every view should end in "build this", "fix this" or "nothing to do".
2. **Explain Railway's numbers in place.** Never show an ambiguous count without saying which one it is.
3. **Show uncertainty honestly.** Pending, unknown, untracked and missing samples stay visible as such.
4. **Glanceable first, deep on demand.** The phone check answers "is money flowing, is anything broken" in one screen; desktop holds the detail.
5. **UI and CLI see the same truth.** Anything the dashboard concludes, an agent can fetch.

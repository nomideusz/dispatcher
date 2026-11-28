Run the daily Dispatcher routine check and write the report.

Follow `.claude/skills/routine/SKILL.md` steps 1–3: `python3 -I .claude/skills/routine/check.py`, then `--only payouts`, and answer in the skill's order (Proposals, Health, Since last check, Upgrades, Candidates, Search, Verdict), short, one recommendation per section.

This run only reads. Do not build, publish, push, upgrade, rename, mark candidates, answer proposals, or set kind, origin, fixed, upgraded or urgent. Do not touch the checklist artifact (step 4). If something needs doing, say what and why in the report; another job or the owner does it.

Start the report with a section "Needs you" listing only what the owner has to decide or do today (a failed payout, new deploys failing on a fast template, an expired login, a draft waiting for approval: `auto/approve` in this repo prints those). Write "Nothing." when that is the case. Then the sections.

A waiting proposal whose note starts with "Scout" was found and judged by the scout job, and its reply is the verdict: list it with that reply, don't evaluate it again. `auto/reports/` holds the latest scout report if you need the reasoning.

If `dispatcherctl` says the session expired, the whole report is that one fact and the command to fix it (`~/go/bin/dispatcherctl login`).

If a PushNotification tool is available, send one line at the end: the "Needs you" items, or "Routine check: nothing needs you".

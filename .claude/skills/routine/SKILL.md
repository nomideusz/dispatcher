---
name: routine
description: Check the Dispatcher operating routine against live data. Use when the owner says "check our routine", "routine check", "how are we doing", "what should I work on today/this week", or opens a session after a break and wants to catch up on health, upgrades, search, candidates and the day-14 verdict.
---

# Routine check

The routine is the checklist at https://claude.ai/artifact/2vHDWt6gxBdmWuGYEyEqMo (source: `page.html` here). Health first, because health holds search position and position drives deploys. Then publish. Upgrades, search, the verdict and payouts are weekly.

## Steps

1. Run `python3 -I .claude/skills/routine/check.py`. It reads live figures with `~/go/bin/dispatcherctl` (logged in to dispatcher.zaur.app), prints a report, and saves them to `last.json` so the next check can say what moved. If dispatcherctl says the session expired, ask the owner to run `! ~/go/bin/dispatcherctl login`.
2. Run `~/go/bin/dispatcherctl payouts --days 14` and look only for a failed or missing transfer.
3. Answer in this order, short, with one recommendation per section:
   - **Health:** name the earning template to fix first, skipping any marked `fix pushed`: health scores the deploys already running, so it lags a fix until deployers take the update or new deploys land. Whenever a health fix is pushed, record it with `dispatcherctl fixed ID YYYY-MM-DD`; if a fixed template is still low a few weeks on with new deploys since the fix, the fix didn't hold. If it has pending upgrades, a patch or minor goes into the same push as the fix. A major goes into a separate push after the fix, so a later drop points at one change. More than 10 earning templates under 70% means fix before publishing.
   - **Since last check:** recovered or new low-health templates, new templates published, any templates still missing a kind or origin. Offer to set them. Origin means original (no other creator had the same app on Railway before ours was published) or competitive; set it with `dispatcherctl origin ID original|competitive`, and leave a template unmarked when you're unsure.
   - **Upgrades:** only if it's been a week or more since the last check. Point at the top of the queue (behind first, then by earnings) and batch per template.
   - **Search:** dropped or missing own keywords. A drop usually means that template's health fell.
   - **Verdict:** nothing is decided until a checkpoint is stored. Day 45 can't be judged until P1 is true for 5 templates (projected around 2026-11-30). When the report says a predictor passed, T4 (the Verdict column, in docs/designs/day-14-template-verdict.md) is unblocked: tell the owner. When a predictor fails, record it in that doc.
4. If the figures moved a lot, offer to refresh the checklist page. Edit `page.html` here (the figures strip, the step numbers, the dates table), read the artifact first with Artifact `action: "read"` and that URL, then publish `page.html` with `url` set to it.

Don't advise against an original on kickback math alone. The owner values originals for themselves.

---
name: health
description: Work on Dispatcher template health. Use when the owner says "/health", "check health", "fix health", or asks which template to fix first. For Railway templates in the Dispatcher catalog, not general service health checks.
---

# Health

Health holds search position, and position drives deploys, so this comes first. Search sorts health in bands, not on a slope: exactly 100, then 70–99 as one band, then unscored, then under 70 (`docs/research/railway-search-ranking.md`). So under 70 costs the most: it sorts below listings with no score at all, and often below rivals a tier or two lower (exact-name Claude Code at 50 was #22 for "claude code"). 99 is worth no more than 70 until it reaches 100. The score is over running deploys only, so a template with no active projects has none, and our own held deploys don't give one (tested 8–9 Nov): only someone else's healthy deploy does.

1. Run `python3 -I .claude/skills/routine/check.py --only health`. If dispatcherctl says the session expired, ask the owner to run `! ~/go/bin/dispatcherctl login`.
2. Follow the **Health** bullet in `.claude/skills/routine/SKILL.md`, which sets the order, the `fix pushed` rule and when a fix didn't hold. Name the earning template to fix first, or work on the one the owner named.
3. Past the under-70 rescues, pick by what reaching exactly 100 wins in search. The score covers at most the 25 most recent deploys (busy templates only take multiples of 4), so size doesn't block 100: one broken deploy costs 4 points until 25 newer ones replace it. Before hunting a bug behind a 96, read the hourly history in `template_snapshots`: a single drop that holds while new deploys keep arriving healthy is one user's instance that will age out, not a template defect. The research's table of health fixes (`docs/research/railway-search-ranking.md`, "Where we stand") lists where 100 pays most, e.g. Hermes Agent Dashboard, Evolution API, Postiz and Twenty CRM.
   The Templates page's Health watch shows the same thing for every low template at once: the fall over 14 days, the new projects and redeploys in that time, and the new projects since a recorded fix. A fall with no new projects is instances already running failing, which no push to the image reaches (measured 10 Nov: pushes don't redeploy deployers' instances).
4. Find the root cause: check its pending upgrades and their changelogs for the symptom, then read logs and memory on a fresh deploy. Railway can show SUCCESS while the app is dead inside the container.
5. Make the fix in `~/dev/railway-templates/<dir>` and canary it. Before pushing, state what you found and what the push changes, and wait for the owner's OK unless the request already said to go ahead: a push to main notifies every deployer.
6. After pushing, record it with `dispatcherctl fixed ID YYYY-MM-DD`.

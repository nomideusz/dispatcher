---
name: health
description: Work on Dispatcher template health. Use when the owner says "/health", "check health", "fix health", or asks which template to fix first. For Railway templates in the Dispatcher catalog, not general service health checks.
---

# Health

Health holds search position, and position drives deploys, so this comes first. Search sorts health in bands, not on a slope: exactly 100, then 70–99 as one band, then unscored, then under 70 (`docs/research/railway-search-ranking.md`). So under 70 costs the most: it sorts below listings with no score at all, and often below rivals a tier or two lower (exact-name Claude Code at 50 was #22 for "claude code"). 99 is worth no more than 70 until it reaches 100. The score is over running deploys only, so a template with no active projects has none, and our own held deploys don't give one (tested 8–9 Nov): only someone else's healthy deploy does.

**Pace decides what a score means** (measured 16 Nov over 207 templates). The score covers at most the 25 latest deploys. "To 25" is the days a template takes to collect 25 new projects at its last 14 days' pace.
- **Fast (to 25 within 30 days):** all 25 count, and new deploys set the score. One bad deploy costs 4 points and ages out once 25 newer ones replace it. A fix shows within days.
- **Slow (over 30 days):** fewer than 25 count, so health moves in odd steps, mostly on instances already running. A push never reaches those (pushes don't redeploy deployers' instances, measured 10 Nov). The score may not see 5 new projects for months.
- **The spiral:** a fast template that slips loses rank, rank brings fewer deploys, and it turns slow, where the score is hard to win back. So catch fast ones first.

## Steps

1. Run `python3 -I .claude/skills/routine/check.py --only health` (`python` on Windows, where `python3` is the Store alias). If dispatcherctl says the session expired, ask the owner to run `! dispatcherctl login`.
2. Pick in this order:
   1. **Still fixable**, printed first: fast templates short of 100. Each line ends with what to do:
      - "new deploys failing, canary a fresh deploy now": points lost in the hours new projects arrived, the most urgent.
      - "instances already running went down": points lost in hours with no new project, while new deploys came up healthy around them. Not a first-boot defect: it ages out like the line below, so canary only when it repeats.
      - "about 1 new deploy in N fails": all 25 replaced and misses remain, so read the recent failed deploys for a pattern.
      - "ages out": a few old misses that healthy new deploys will push out, so leave it.
   2. **Under 70, earning**, by the **Health** bullet in `.claude/skills/routine/SKILL.md`. That bullet covers the order, the `fix pushed` rule and when a fix didn't hold. A line that says "fell under N% (its low around the fix) with no new projects" is back on the list despite its fix: instances already running are failing, which that fix didn't address. The floor is the lowest reading on the fix day and the day before, because a score that swings hour to hour can read high on the last sample before a fix.
   3. **Past those**, pick by what reaching exactly 100 wins in search: the research's table of health fixes (`docs/research/railway-search-ranking.md`, "Where we stand"), e.g. Hermes Agent Dashboard, Evolution API, Postiz and Twenty CRM.
3. Before hunting a bug, read the template's hours. The Health page's One template view (`/health?t=ID#detail`) shows hourly health beside new projects per day, To 25 over time, every move with what moved in that hour, and its search positions. `dispatcherctl get "/api/analytics/templates/ID/projects?days=30"` gives the same rows.
   - **A move in an hour a new project arrived** is that deploy.
   - **A move with no new project** is an instance already running changing state.
   - **A single 4-point drop** that holds while new deploys keep arriving healthy is one user's instance that will age out, not a template defect.
4. Find the root cause where the failure lives.
   - **Fast templates, and falls with new projects:** look at first boot. Check pending upgrades and their changelogs for the symptom, then read logs and memory on a fresh deploy.
   - **Slow templates falling with no new projects:** look at what kills an instance that has run for days, such as memory growth, a filling disk or a trial running out of credit. Use a held canary (`HOLD=1`) left up for hours, with memory read from Railway's metrics on this machine (see the Windows tooling memory).
   - **Either way,** Railway can show SUCCESS while the app is dead inside the container.
5. Make the fix in `~/dev/railway-templates/<dir>` and canary it. Before pushing, state what you found and what the push changes, and wait for the owner's OK unless the request already said to go ahead: a push to main notifies every deployer.
6. After pushing, record it with `dispatcherctl fixed ID YYYY-MM-DD`. Judge it by pace.
   - **Fast template:** 5 new projects since the fix decide it.
   - **Slow template:** the check says "verify with a held canary, not the score". The canary staying healthy for as long as the instances used to fail is the evidence. The score follows only as old instances go and new ones arrive.

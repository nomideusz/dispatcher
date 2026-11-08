---
name: upgrades
description: Work the Dispatcher template upgrade queue. Use when the owner says "/upgrades", "do upgrades", "check upgrades", or asks what to upgrade next.
---

# Upgrades

1. Run `python3 -I .claude/skills/routine/check.py --only upgrades`. If dispatcherctl says the session expired, ask the owner to run `! ~/go/bin/dispatcherctl login`.
2. Follow the **Upgrades** bullet in `.claude/skills/routine/SKILL.md`. Urgent first: read the release notes between our tag and the latest for every template with running instances, and record each security fix or breakage fix with `dispatcherctl urgent ID "REASON"`. `dispatcherctl upgrades` has the full list, including templates that earned nothing. If the owner named a template, work on that one, and still report anything urgent you find.
3. Propose the batch: which templates, which versions, and why these first. Put every line of one template into one push, and hold back a days-old release with an open regression report. That includes a major, unless it has to migrate data, such as a database: that one gets its own tested change.
4. Wait for the owner's OK before the first push unless the request already said to go ahead: a push to main notifies every deployer.
5. Apply it in `~/dev/railway-templates/<dir>`. The memory note on the upgrade push workflow says where each kind of pin lives and lists the known traps. Canary each one. `canary.py` only checks that services reach SUCCESS, so test broker and database bumps by hand as that note describes.
6. Record each pushed template on the day of the push with `dispatcherctl upgraded ID YYYY-MM-DD`, so the Upgrades page and the routine count the week from the push, not from the next morning's check.
7. Finish with what was pushed, what was held back and why, and what's next in the queue.

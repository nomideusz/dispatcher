---
name: candidates
description: Check Dispatcher's Candidates page and proposals inbox to decide what template to build next. Use when the owner says "/candidates", "check candidates", "check proposals", or asks what to publish next.
---

# Candidates

1. Run `python3 -I .claude/skills/routine/check.py --only candidates`. If dispatcherctl says the session expired, ask the owner to run `! ~/go/bin/dispatcherctl login`.
2. Answer waiting proposals first, following the **Proposals** bullet in `.claude/skills/routine/SKILL.md`.
3. If more than 10 earning templates are under 70% health (`--only health`), say to fix before publishing. Every new template adds to the health and upgrade load for good.
4. Evaluate the shortlist, then the most deployed apps we don't publish. For each pick, check that it runs as a Railway service, and who holds the market: vendor-owned deploys and features Railway IPs can't do have sunk picks before. Search `templateSearch` for every variant of the name before calling it open.
5. Before recommending one, read the keyword the way search will rank it (`docs/research/railway-search-ranking.md`): count the listings whose name or slug is the app name, and how many of them sit at 100 health. With three or more such listings at 100 and many running deploys, we start at #4 or lower and stay there until our running deploys pass theirs. If they're unscored or under 70, a healthy exact-name template takes #1.
6. Judge an original on its own terms, never on kickback math alone. Check the "ours, but others take most" list too, since fixing a listing is cheaper than building.
7. When building, name and slug it for search. Only the name, slug and description are searched, not the readme or tags. Search matches the start of words: no stemming, no typo tolerance. So the name is the app's exact name, plus a " | tagline" only when the tagline wins a bigger generic word. Secondary words go in the description. The slug is first-come and can never change: claim the bare app name, never `-production` or `-1`.
8. Recommend one or two, and wait for the owner's OK before building. Marking shortlist or skip is the owner's call.

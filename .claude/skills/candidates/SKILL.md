---
name: candidates
description: Check Dispatcher's Candidates page and proposals inbox to decide what template to build next. Use when the owner says "/candidates", "check candidates", "check proposals", or asks what to publish next.
---

# Candidates

1. Run `python3 -I .claude/skills/routine/check.py --only candidates`. If dispatcherctl says the session expired, ask the owner to run `! ~/go/bin/dispatcherctl login`.
2. Answer waiting proposals first, following the **Proposals** bullet in `.claude/skills/routine/SKILL.md`.
3. If more than 10 earning templates are under 70% health (`--only health`), say to fix before publishing. Every new template adds to the health and upgrade load for good.
4. Evaluate the shortlist, then the most deployed apps we don't publish. For each pick, check that it runs as a Railway service, and who holds the market: vendor-owned deploys and features Railway IPs can't do have sunk picks before. Search `templateSearch` for every variant of the name before calling it open.
5. Judge an original on its own terms, never on kickback math alone. Check the "ours, but others take most" list too, since fixing a listing is cheaper than building.
6. Recommend one or two, and wait for the owner's OK before building. Marking shortlist or skip is the owner's call.

---
name: search
description: Check where Dispatcher templates rank in Railway's marketplace search. Use when the owner says "/search", "check search", or asks about keyword positions, drops or gaps. Not for searching code or the web.
---

# Search

1. Run `python3 -I .claude/skills/routine/check.py --only search`. If dispatcherctl says the session expired, ask the owner to run `! ~/go/bin/dispatcherctl login`.
2. Read every position with the rule from `docs/research/railway-search-ranking.md` (summarised in the **Search** bullet of `.claude/skills/routine/SKILL.md`): text tier, then health band, then running deploys. The report's "own keywords not at #1" lines give our tier, band and active projects for each one, and say whether the templates above have a better tier.
3. Report drops and missing names first, with the cause:
   - **Better tier above:** a rival's name or slug matches the query more exactly. Health can't fix that; only the name can, and renames have mostly lost more generic words than they won (see the report's renames section).
   - **Same tier, ours under 100:** 70–99 is one flat band, so the lever is reaching exactly 100. Under 70 is the urgent case: it sorts below unscored listings and often below rivals a tier or two lower.
   - **Same tier, ours unscored:** no one else has an active project from it, so there is no score. Our own held deploy doesn't fix that (three canaries stayed unscored for 29 hours, 8–9 Nov); the lever is the first outside deploy. An unscored template still holds #1 when no scored rival shares its tier.
   - **Same tier and band:** running deploys decide. Doubling them is worth about one position.
   Size a move with the position curve: #1 takes 29.7% of a keyword's deploys, #2 17.3%, #3 10.8%, #4 9.0%, so the top four take 67%.
   For one keyword's full results, read `~/go/bin/dispatcherctl get /api/search`.
4. Cheapest listing changes, before any rename:
   - **Description:** it's searched, edits are indexed within the hour, and a multi-word query can take its words from different fields ("linux server" finds "Linux" through "server" in the description). Adding "Kubuntu", "Xubuntu" and "Lubuntu" made each Linux Desktop the only result for its word. Keep it short: longer descriptions rank slightly lower.
   - **Rename:** read the template's full keyword list with and without the tagline first. A tagline costs the app-name keyword one tier, but it's often what wins a bigger generic word (Linux Terminal would lose "ssh" #3 → #21). Twenty's 5 Nov rename was reverted after "twenty crm" fell from #5 to #10. The slug can never change.
5. Then the gaps worth acting on. Demand counts deploys of the templates a keyword returns, not searches, and keywords returning the same templates share one figure. Before calling a gap an opening, count the tier-0 listings (exact name or slug) at 100 health: each one with more running deploys than we could reach sits above us for good. A free exact slug on a generic word is the strongest opening: on 9 Nov `ssh` and `mint` went to #1 within minutes while unscored, and the free-slug scan found 76 of the top 221 keywords with a free exact slug. `python3 -I .claude/skills/candidates/opening.py "KEYWORD"` says whether a slug is free.
6. End with one recommendation. Adding a keyword or changing a listing is the owner's call: ask first. Track a keyword with `~/go/bin/dispatcherctl track "KEYWORD"` (`untrack` stops it), or from the Search page.

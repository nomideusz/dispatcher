---
name: search
description: Check where Dispatcher templates rank in Railway's marketplace search. Use when the owner says "/search", "check search", or asks about keyword positions, drops or gaps. Not for searching code or the web.
---

# Search

1. Run `python3 -I .claude/skills/routine/check.py --only search`. If dispatcherctl says the session expired, ask the owner to run `! ~/go/bin/dispatcherctl login`.
2. Read every position with the rule from `docs/research/railway-search-ranking.md` (summarised in the **Search** bullet of `.claude/skills/routine/SKILL.md`): text tier, then health band, then running deploys. The report's "own keywords not at #1" lines give our tier, band and active projects for each one, and say whether the templates above have a better tier.
3. Report drops and missing names first, with the cause:
   - **Better tier above:** a rival's name or slug matches the query more exactly. Health can't fix that; only the name can, and renames have mostly lost more generic words than they won (see the report's renames section).
   - **Same tier, ours under 100:** 70–99 is one flat band, so the lever is reaching exactly 100. Under 70 is the urgent case, because it sorts below unscored listings.
   - **Same tier, ours unscored:** nothing of ours is active, so there is no score. One healthy running deploy gives it a score; the report's playbook has the canary test for that.
   - **Same tier and band:** running deploys decide. Doubling them is worth about one position.
   For one keyword's full results, read `~/go/bin/dispatcherctl get /api/search`.
4. Then the gaps worth acting on. Demand counts deploys of the templates a keyword returns, not searches, and keywords returning the same templates share one figure. Before calling a gap an opening, count the tier-0 listings (exact name or slug) at 100 health: each one with more running deploys than we could reach sits above us for good.
5. End with one recommendation. Adding a keyword or changing a listing is the owner's call: ask first. Track a keyword with `POST /api/search/keywords`, or from the Search page.

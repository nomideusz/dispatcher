---
name: search
description: Check where Dispatcher templates rank in Railway's marketplace search. Use when the owner says "/search", "check search", or asks about keyword positions, drops or gaps. Not for searching code or the web.
---

# Search

1. Run `python3 -I .claude/skills/routine/check.py --only search`. If dispatcherctl says the session expired, ask the owner to run `! ~/go/bin/dispatcherctl login`.
2. Report drops and missing template names first. A drop usually means that template's health fell, so check its health before anything else. For one keyword's full results, read `~/go/bin/dispatcherctl get /api/search`.
3. Then the gaps worth acting on. Demand counts big templates more than once, and one template often holds most of a keyword by name, not by position, so look at who holds it before calling it an opening.
4. End with one recommendation. Adding a keyword or changing a listing is the owner's call: ask first. Track a keyword with `POST /api/search/keywords`, or from the Search page.

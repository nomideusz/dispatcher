---
name: catalog
description: Fill in missing kind and origin on Dispatcher templates. Use when the owner says "/catalog", "check the catalog", or asks which templates have no kind or origin.
---

# Catalog

1. Run `python3 -I .claude/skills/routine/check.py --only catalog`. If dispatcherctl says the session expired, ask the owner to run `! ~/go/bin/dispatcherctl login`. Template IDs are in `~/go/bin/dispatcherctl templates`.
2. Set a kind with `dispatcherctl kind ID KIND`: business, ai, media, desktop, agent or devtools.
3. Set an origin with `dispatcherctl origin ID original|competitive`. Original means no other creator had the same app on Railway before ours was published. Leave a template unmarked when you're unsure, since origin feeds the verdict's split.
4. List what you set and what you left unmarked.

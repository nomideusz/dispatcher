#!/usr/bin/env python3
"""Run from ~/dev/railway-templates. Prints what the publish job has to do and exits 0, or
says why there is nothing to do and exits 3. No network: the approved list and the publish
log are files."""
import datetime, json, os, sys
sys.path.insert(0, os.getcwd())
import publish as p

LIST = "publish-approved.txt"
approved = [l.strip().rstrip("/") for l in open(LIST)] if os.path.exists(LIST) else []
approved = [d for d in approved if d and not d.startswith("#")]
ready, stale = [], []
for d in approved:
    try:
        m = json.load(open(f"{d}/template-meta.json"))
    except Exception:
        stale.append(f"{d} (no template-meta.json)"); continue
    if m.get("published"): stale.append(f"{d} (already published)")
    elif not m.get("id"): stale.append(f"{d} (never test-deployed)")
    else: ready.append(d)
if not ready:
    print("nothing approved is waiting" + (f"; stale entries: {', '.join(stale)}" if stale else "")); sys.exit(3)
used = p.recent_publishes()
free = p.DAILY_NEW - len(used)
if free <= 0:
    frees = (used[0][0] + datetime.timedelta(hours=24)).strftime("%m-%d %H:%M UTC")
    print(f"approved and waiting: {', '.join(ready)}; no slot until {frees}"); sys.exit(3)
print(f"approved and waiting: {', '.join(ready)}; {free} slot(s) free")

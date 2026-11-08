#!/usr/bin/env python3
"""Where would a new template of ours rank for a keyword?

    python3 -I .claude/skills/candidates/opening.py "open webui" metabase ...

Reads Railway's public search for each keyword, then each result's health and
active projects, and applies the ranking rule from
docs/research/railway-search-ranking.md: text tier, then health band (100 >
70-99 > unscored > under 70), then active projects. A new template named
exactly for the keyword is tier 0. It starts unscored, since nothing runs it,
and once someone runs it healthily it is a tier-0 100 with few active projects.
"""
import importlib.util
import json
import os
import sys
import time
import urllib.request

G = "https://backboard.railway.com/graphql/v2"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True  # importing check.py must not leave a __pycache__ in the skill
_spec = importlib.util.spec_from_file_location("check", os.path.join(HERE, "..", "routine", "check.py"))
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)
tier = check.tier


def gql(query, variables):
    body = json.dumps({"query": query, "variables": variables}).encode()
    for attempt in range(4):
        try:
            req = urllib.request.Request(G, body, {"content-type": "application/json", "user-agent": "dispatcher-candidates"})
            d = json.load(urllib.request.urlopen(req, timeout=30))
            if "errors" in d:
                raise RuntimeError(d["errors"][0]["message"])
            return d["data"]
        except Exception as e:  # Railway rate-limits the marketplace: back off and retry
            if attempt == 3:
                sys.exit(f"Railway query failed for {variables}: {e}")
            time.sleep(3 * (attempt + 1))


def band_rank(h):
    """Lower sorts first: exactly 100, 70-99, unscored, under 70."""
    if h is None:
        return 2
    return 0 if h >= 100 else 1 if h >= 70 else 3


def read(q, n=10):
    rows = [e["node"] for e in gql("query($q:String!){templateSearch(query:$q){edges{node{code name}}}}", {"q": q})["templateSearch"]["edges"]][:n]
    for r in rows:
        time.sleep(0.7)
        r.update(gql("query($c:String!){template(code:$c){health activeProjects isVerified creator{name}}}", {"c": r["code"]})["template"] or {})
        r["tier"] = tier(q, r["name"], r["code"])
    return rows


def where(rows, health, active):
    """1-based position a tier-0 template with this health and active count
    would take. A verified listing in tier 0 counts as ahead whatever its band:
    Railway verifies vendors' own templates, and those sit high (the research
    could measure no more than that)."""
    key = (0, band_rank(health), -active)
    return 1 + sum(1 for r in rows
                   if (r["tier"] == 0 and r.get("isVerified"))
                   or (r["tier"], band_rank(r.get("health")), -(r.get("activeProjects") or 0)) < key)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for q in sys.argv[1:]:
        rows = read(q)
        print(f"{q}:")
        for i, r in enumerate(rows, 1):
            h = r.get("health")
            print(f"  #{i:<2} tier {r['tier']}  health {h if h is not None else '-':>4}  active {r.get('activeProjects') or 0:>6}"
                  f"  {r['name'][:50]}  ({r['code']}, {(r.get('creator') or {}).get('name') or '?'}"
                  + (", verified)" if r.get("isVerified") else ")"))
        t0 = [r for r in rows if r["tier"] == 0]
        at100 = [r for r in t0 if r.get("health") is not None and r["health"] >= 100]
        print(f"  tier 0: {len(t0)} listings, {len(at100)} at 100"
              + (f" (active {', '.join(str(r.get('activeProjects') or 0) for r in at100)})" if at100 else ""))
        print(f"  a new exact-name template: about #{where(rows, None, 0)} while unscored,"
              f" #{where(rows, 100, 1)} once one deploy runs it at 100,"
              f" #{where(rows, 100, 20)} at 100 with 20 active")
        time.sleep(1)


if __name__ == "__main__":
    main()

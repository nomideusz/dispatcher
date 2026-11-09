"""Does the owner's own deploy give an unscored template a health score?

Reads Railway's public templateSearch for each probe keyword and records, for
every result in the top 10, its position, health and active projects. Each run
appends one JSON line to probe-log.jsonl beside this file and prints the
probed templates' rows, so runs before and after holding a deploy compare.

    python3 -I score_probe.py            # record and print
    python3 -I score_probe.py --show     # print the log's history only
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timezone

G = "https://backboard.railway.com/graphql/v2"
HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "probe-log.jsonl")
# Held from 2026-11-08: our code -> the keywords it should move on.
PROBES = {
    "wordpress-pro": ["wordpress", "wordpress pro"],
    "searxng-search": ["searxng", "searxng search"],
    "umami-web-analytics": ["umami"],
    # From 2026-11-08: the "Linux" server template (railway-templates/linux), slug `linux`.
    # Baseline runs come before it is published. "linux" tests whether an unscored
    # exact name+slug outranks our 70-99 "Linux Terminal"/"Linux Desktop" (tier 1).
    # The other queries match its description ("Linux server: SSH, web terminal, ...").
    "linux": ["linux", "linux server", "linux terminal", "linux ssh", "web terminal", "server", "ssh", "terminal"],
    # From 2026-11-08: "Fedora" (slug fedora-linux) against the unhealthy `fedora` (33).
    "fedora-linux": ["fedora", "fedora linux", "fedora desktop"],
    # From 2026-11-08: flavour names added to these descriptions; each query had 0 results.
    "linux-desktop-kde": ["kubuntu"],
    "linux-desktop": ["xubuntu"],
    "linux-desktop-lxqt": ["lubuntu"],
    # From 2026-11-09: "Linux Mint". First published as `linux-mint` (02:25 UTC, #3 for "mint"),
    # then republished as `mint` (~02:40 UTC, #1 for "mint") so the slug makes it tier 0 for "mint" too.
    "mint": ["linux mint", "mint", "mint desktop"],
}
# Search results carry only names and codes; health comes from template(code:).
Q = """query($q:String!){templateSearch(query:$q){edges{node{code name}}}}"""
T = """query($c:String!){template(code:$c){health activeProjects recentProjects}}"""


def gql(query, variables):
    body = json.dumps({"query": query, "variables": variables}).encode()
    for attempt in range(4):
        try:
            req = urllib.request.Request(G, body, {"content-type": "application/json", "user-agent": "dispatcher-research"})
            d = json.load(urllib.request.urlopen(req, timeout=30))
            if "errors" in d:
                raise RuntimeError(d["errors"][0]["message"])
            return d["data"]
        except Exception as e:
            print("retry", variables, e, file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    sys.exit(f"query failed for {variables}")


def search(q):
    rows = [e["node"] for e in gql(Q, {"q": q})["templateSearch"]["edges"]][:10]
    for r in rows:
        time.sleep(0.7)
        r.update(gql(T, {"c": r["code"]})["template"] or {})
    return rows


def show(run):
    print(run["at"])
    for code, kws in PROBES.items():
        for q in kws:
            rows = run["results"].get(q, [])
            mine = next((r for r in rows if r["code"] == code), None)
            pos = rows.index(mine) + 1 if mine else None
            above = ", ".join(f"{r['code']} {r['health'] if r['health'] is not None else '-'}/{r['activeProjects']}" for r in rows[: (pos or 11) - 1][:4])
            print(f"  {q:16} {code:22} #{pos or '>10'}  health {mine['health'] if mine else '?'}  active {mine['activeProjects'] if mine else '?'}"
                  f"   above: {above or 'none'}")


def main():
    if "--show" in sys.argv:
        for line in open(LOG):
            show(json.loads(line))
        return
    run = {"at": datetime.now(timezone.utc).isoformat(timespec="minutes"), "results": {}}
    for kws in PROBES.values():
        for q in kws:
            run["results"][q] = search(q)
            time.sleep(0.7)
    with open(LOG, "a") as fh:
        fh.write(json.dumps(run) + "\n")
    show(run)


if __name__ == "__main__":
    main()

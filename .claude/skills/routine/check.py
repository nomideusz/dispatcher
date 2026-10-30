#!/usr/bin/env python3
"""Routine check: live figures from dispatcherctl, compared with the last run.

Prints one report and saves the figures to last.json beside this file, so the
next run (days or weeks later) can say what moved. --dry-run skips the save.
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
LAST = os.path.join(HERE, "last.json")
CTL = os.environ.get("DISPATCHERCTL") or os.path.expanduser("~/go/bin/dispatcherctl")
HEALTH_FLOOR = 70  # the checklist's "under 70%" line
FIX_FIRST = 10  # earning templates under the floor before publishing pauses


def get(*args):
    out = subprocess.run([CTL, "--compact", *args], capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        sys.exit(f"dispatcherctl {' '.join(args)} failed: {out.stderr.strip()}")
    return json.loads(out.stdout)


def figures(timeline, upgrades, search, candidates, verdicts):
    ts = timeline["templates"]
    by_template = {}
    for u in upgrades:
        if u.get("behind") in ("patch", "minor") or u.get("major"):
            by_template.setdefault(u["templateId"], []).append(u)
    low = sorted(
        (t for t in ts if t.get("health") is not None and t["health"] < HEALTH_FLOOR and (t.get("running") or 0) > 0),
        key=lambda t: (-(t.get("earnedCents") or 0), t["health"]),
    )
    own = [k for k in search["keywords"] if k["source"] == "ours"]
    d45 = verdicts["provisional"][0]
    d90 = verdicts["provisional"][1] if len(verdicts["provisional"]) > 1 else {"n": 0}
    return {
        "at": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "templates": len(ts),
        "ids": sorted(t["templateId"] for t in ts),
        "earned30dCents": sum(t.get("earnedCents") or 0 for t in ts),
        "low": [
            {
                "name": t["name"],
                "health": round(t["health"]),
                "earnedCents": t.get("earnedCents") or 0,
                "fixedOn": t.get("fixedOn") or "",
                "upgrades": sorted({u.get("behind") or "" for u in by_template.get(t["templateId"], [])} - {""})
                + (["major"] if any(u.get("major") for u in by_template.get(t["templateId"], [])) else []),
            }
            for t in low
        ],
        "lowEarning": sum(1 for t in low if (t.get("earnedCents") or 0) > 0),
        "behind": {b: sum(1 for u in upgrades if u.get("behind") == b) for b in ("patch", "minor", "floating")},
        "majors": sum(1 for u in upgrades if u.get("major")),
        "noKind": [t["name"] for t in ts if not t["kind"]],
        "noOrigin": [t["name"] for t in ts if not t.get("origin")],
        "ownKeywords": len(own),
        "ownTop": sum(1 for k in own if k["best"] == 1),
        "ownMissing": [k["query"] for k in own if k["best"] is None],
        "ownDropped": [
            f"{k['query']} #{k['prevBest'] or '-'}→#{k['best'] or 'out'}"
            for k in own
            if k["searchedBefore"] and (k["best"] or 21) > (k["prevBest"] or 21)
        ],
        "gaps": sum(1 for k in search["keywords"] if k["demand"] > 0 and (k["best"] is None or k["best"] > 3)),
        "shortlist": sum(1 for g in candidates["groups"] if g.get("status") == "shortlist"),
        "verdict": {
            "checkpoint": verdicts["checkpoint"] and {
                "horizon": verdicts["checkpoint"]["horizon"],
                "p1": verdicts["checkpoint"]["p1"]["result"],
                "p2": verdicts["checkpoint"]["p2"]["result"],
            },
            "d45n": d45["n"],
            "d45positives": d45["positives"],
            "d45p1True": d45["p1"]["trueN"],
            "d90n": d90["n"],
        },
    }


def delta(now, before, key):
    if before is None or key not in before:
        return ""
    d = now[key] - before[key]
    return f" ({'+' if d > 0 else ''}{d})" if d else " (=)"


def report(f, last):
    print(f"Routine check {f['at']}" + (f", last check {last['at']}" if last else ", first check"))
    print()
    print(f"HEALTH: {len(f['low'])} live templates under {HEALTH_FLOOR}%, {f['lowEarning']} of them earning" + delta(
        {"n": f["lowEarning"]}, last and {"n": last["lowEarning"]}, "n"))
    if f["lowEarning"] > FIX_FIRST:
        print(f"  over {FIX_FIRST} earning: fix before you publish")
    for t in f["low"][:10]:
        up = f"  upgrades pending: {', '.join(t['upgrades'])}" if t["upgrades"] else ""
        fixed = f"  fix pushed {t['fixedOn']}" if t.get("fixedOn") else ""
        print(f"  {t['health']:>3}%  ${t['earnedCents'] / 100:>7.2f}/30d  {t['name']}{fixed}{up}")
    if last:
        was = {t["name"] for t in last["low"]}
        fixed = sorted(was - {t["name"] for t in f["low"]})
        new = [t["name"] for t in f["low"] if t["name"] not in was]
        if fixed:
            print(f"  recovered since last: {', '.join(fixed)}")
        if new:
            print(f"  new since last: {', '.join(new)}")
    print()
    added = len(set(f["ids"]) - set(last["ids"])) if last else None
    print(f"CATALOG: {f['templates']} live" + (f", {added} new since last" if added is not None else "")
          + f"; earned 30d ${f['earned30dCents'] / 100:,.2f}" + delta(
        {"c": f["earned30dCents"] // 100}, last and {"c": last["earned30dCents"] // 100}, "c"))
    if f["noKind"]:
        print(f"  no kind: {', '.join(f['noKind'])}")
    if f["noOrigin"]:
        print(f"  no origin ({len(f['noOrigin'])}): {', '.join(f['noOrigin'][:12])}{' …' if len(f['noOrigin']) > 12 else ''}")
    print()
    b = f["behind"]
    print(f"UPGRADES: {b['patch']} patch, {b['minor']} minor, {b['floating']} floating, {f['majors']} with a newer major")
    print()
    print(f"SEARCH: #1 on {f['ownTop']} of {f['ownKeywords']} own keywords" + delta(f, last, "ownTop")
          + f"; {f['gaps']} gaps; shortlist {f['shortlist']}")
    if f["ownDropped"]:
        print(f"  dropped this week: {', '.join(f['ownDropped'])}")
    if f["ownMissing"]:
        print(f"  missing: {', '.join(f['ownMissing'])}")
    print()
    v = f["verdict"]
    cp = v["checkpoint"]
    print("VERDICT: " + (f"checkpoint day {cp['horizon']}: P1 {cp['p1']}, P2 {cp['p2']}" if cp else "no checkpoint yet")
          + f"; day 45 n={v['d45n']}, rose={v['d45positives']}, P1 true={v['d45p1True']} (needs 5); day 90 n={v['d90n']}")
    if cp and "pass" in (cp["p1"], cp["p2"]):
        print("  a predictor passed: T4 (Verdict column) is unblocked")


def main():
    last = None
    try:
        with open(LAST) as fh:
            last = json.load(fh)
    except (OSError, ValueError):
        pass
    f = figures(
        get("get", "/api/analytics/timeline"),
        get("upgrades"),
        get("get", "/api/search"),
        get("get", "/api/candidates"),
        get("get", "/api/analytics/verdicts"),
    )
    report(f, last)
    if "--dry-run" not in sys.argv:
        with open(LAST, "w") as fh:
            json.dump(f, fh)


if __name__ == "__main__":
    main()

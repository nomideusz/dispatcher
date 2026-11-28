#!/usr/bin/env python3
"""Collect apps worth a look from the places the owner used to read by hand.

  scout.py OUT.json        write the new finds to OUT.json, print a summary
  scout.py --commit FILE   mark the finds in FILE as seen (run after they were triaged)
  scout.py --sources       list the sources and what each returned, record nothing

Two kinds of source. A feed (GitHub trending, a newsletter, Show HN) gives whatever is on
it today. A catalog (selfh.st's directory, the app stores of Coolify, Dokploy, Umbrel and
Runtipi, awesome-selfhosted) gives only what was added since the last read; the first read
of a catalog records it and gives nothing, so a new catalog never floods the inbox.

Dropped here, before any model reads them: repos already in Dispatcher's proposals, apps
whose name matches a template we publish, and anything given out before (120 days).
Extra pages go in auto/scout-sources.txt, one URL per line: every GitHub repo linked from
the page counts as a find."""
import concurrent.futures, datetime, html, json, os, re, subprocess, sys, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.expanduser("~/.local/state/dispatcher-auto/scout-state.json")
TEMPLATES = os.path.expanduser("~/dev/railway-templates")
CTL = os.path.expanduser("~/go/bin/dispatcherctl")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) feed-reader", "Accept": "*/*"}
TODAY = datetime.date.today()
CAP = 120          # finds handed over per run; the rest wait for the next one
KEEP_DAYS = 120    # a find given out is not given again for this long
REPO = re.compile(r"github\.com/([A-Za-z0-9][A-Za-z0-9-]*)/([A-Za-z0-9._-]+)")
NOT_OWNERS = {"sponsors", "orgs", "features", "topics", "collections", "trending", "marketplace", "about",
              "login", "join", "pricing", "apps", "settings", "site", "security", "contact", "readme",
              "customer-stories", "enterprise", "team", "solutions", "resources", "events", "search", "user-attachments"}


def get(url, timeout=25):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read().decode("utf-8", "replace")


def api(path):
    """GitHub's API through gh when it is logged in (5,000 calls an hour), else anonymously (60)."""
    try:
        r = subprocess.run(["gh", "api", path], capture_output=True, text=True, timeout=40)
        if r.returncode == 0:
            return json.loads(r.stdout)
    except Exception:
        pass
    return json.loads(get("https://api.github.com/" + path))


def repo_key(text):
    """owner/repo, lowercased, from anything that holds a GitHub repo link."""
    m = REPO.search(text or "")
    if not m or m.group(1).lower() in NOT_OWNERS:
        return None
    name = m.group(2)
    name = name[:-4] if name.endswith(".git") else name
    return f"{m.group(1)}/{name.rstrip('.')}".lower()


def norm(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def find(source, signal, repo=None, name=None, url=None, desc="", stars=None):
    key = repo.lower() if repo else f"{source}:{norm(name)}"
    return {"key": key, "url": f"https://github.com/{repo}" if repo else url, "name": name or repo.split("/")[1],
            "desc": re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", desc or ""))).strip()[:300],
            "stars": stars, "sources": [f"{source}: {signal}" if signal else source]}


# ---- feeds: whatever is on them today -------------------------------------------------

def github_trending():
    out = []
    pages = [("", "daily"), ("", "weekly")] + [(lang, "weekly") for lang in ("go", "typescript", "python", "rust", "php")]
    for lang, since in pages:
        page = get(f"https://github.com/trending/{lang}?since={since}")
        for art in page.split('<article class="Box-row">')[1:]:
            m = re.search(r'<h2 class="h3 lh-condensed">\s*<a[^>]*href="/([^"]+)"', art)
            if not m:
                continue
            desc = re.search(r'<p class="col-9[^>]*>\s*(.*?)\s*</p>', art, re.S)
            gained = re.search(r"([\d,]+) stars (?:today|this week)", art)
            total = re.search(r'/stargazers"[^>]*>\s*(?:<svg.*?</svg>)?\s*([\d,]+)', art, re.S)
            period = "today" if since == "daily" else "this week"
            out.append(find("GitHub trending" + (f" ({lang})" if lang else ""),
                            f"+{gained.group(1)} stars {period}" if gained else since, repo=m.group(1),
                            desc=desc.group(1) if desc else "", stars=int(total.group(1).replace(",", "")) if total else None))
    return out


def github_new_selfhosted():
    since = (TODAY - datetime.timedelta(days=60)).isoformat()
    out = []
    for topic in ("self-hosted", "selfhosted", "docker-compose"):
        q = urllib.parse.urlencode({"q": f"topic:{topic} created:>{since} stars:>150", "sort": "stars", "per_page": 40})
        for r in api("search/repositories?" + q)["items"]:
            out.append(find("GitHub new repos", f"topic {topic}, created {r['created_at'][:10]}", repo=r["full_name"],
                            desc=r.get("description") or "", stars=r["stargazers_count"]))
    return out


def selfhst_weekly():
    feed = get("https://selfh.st/rss/")
    posts = [u for u in re.findall(r"<link>([^<]+)</link>", feed) if "/weekly/" in u][:2]
    out = []
    for post in posts:
        label = post.rstrip("/").rsplit("/", 1)[-1]
        for m in set(REPO.findall(get(post))):
            key = repo_key("github.com/" + "/".join(m))
            if key and not key.startswith("selfhst/"):
                out.append(find("selfh.st weekly", label, repo=key))
    return out


def hacker_news():
    week = int((datetime.datetime.now() - datetime.timedelta(days=8)).timestamp())
    out = []
    for query in ("self-hosted", "selfhosted", "open source"):
        q = urllib.parse.urlencode({"tags": "show_hn", "query": query, "hitsPerPage": 40,
                                    "numericFilters": f"points>40,created_at_i>{week}"})
        for h in json.loads(get("https://hn.algolia.com/api/v1/search_by_date?" + q))["hits"]:
            key = repo_key(h.get("url") or "")
            if key:
                out.append(find("Show HN", f"{h['points']} points", repo=key, desc=h["title"]))
    return out


def trendshift():
    return [find("Trendshift", "", repo=k) for k in {repo_key("github.com/" + "/".join(m)) for m in REPO.findall(get("https://trendshift.io/"))} if k]


def extra_pages():
    path = os.path.join(HERE, "scout-sources.txt")
    out = []
    if not os.path.exists(path):
        return out
    for line in open(path):
        url = line.split("#")[0].strip()
        if not url.startswith("http"):
            continue
        host = urllib.parse.urlparse(url).netloc
        try:
            page = get(url)
        except Exception as e:
            print(f"  {host}: {e}", file=sys.stderr)
            continue
        for m in set(REPO.findall(page)):
            key = repo_key("github.com/" + "/".join(m))
            if key:
                out.append(find(host, "", repo=key))
    return out


# ---- catalogs: only what was added since the last read --------------------------------

def selfhst_directory():
    rows = json.loads(get("https://cdn.jsdelivr.net/gh/selfhst/cdn@main/directory/software.json"))
    out = {}
    for r in rows:
        if len(r) < 14 or not isinstance(r[1], str):
            continue
        stars = int(r[13]) if str(r[13]).isdigit() else None
        out[r[2] or norm(r[1])] = find("selfh.st directory", "new entry", repo=repo_key(r[4]), name=r[1],
                                       url="https://" + r[3] if r[3] else None, desc=r[5], stars=stars)
    return out


def coolify():
    data = json.loads(get("https://raw.githubusercontent.com/coollabsio/coolify/v4.x/templates/service-templates.json"))
    return {k: find("Coolify services", "new one-click service", repo=repo_key(v.get("documentation", "")), name=k,
                    url=(v.get("documentation") or "").split("?")[0] or None, desc=v.get("slogan", "")) for k, v in data.items()}


def github_dir(repo, path, source, signal, skip=()):
    def read():
        rows = api(f"repos/{repo}/contents/{path}")
        return {r["name"]: find(source, signal, name=r["name"], url=r["html_url"]) for r in rows
                if r["type"] == "dir" and not r["name"].startswith(".") and r["name"] not in skip}
    return read


def awesome_selfhosted():
    tree = api("repos/awesome-selfhosted/awesome-selfhosted-data/git/trees/master?recursive=1")
    out = {}
    for t in tree["tree"]:
        m = re.fullmatch(r"software/([^/]+)\.yml", t["path"])
        if m:
            out[m.group(1)] = find("awesome-selfhosted", "new entry", name=m.group(1),
                                   url=f"https://github.com/awesome-selfhosted/awesome-selfhosted-data/blob/master/{t['path']}")
    return out


FEEDS = {"github-trending": github_trending, "github-new-selfhosted": github_new_selfhosted,
         "selfhst-weekly": selfhst_weekly, "hacker-news": hacker_news, "trendshift": trendshift, "extra-pages": extra_pages}
CATALOGS = {"selfhst-directory": selfhst_directory, "coolify": coolify, "awesome-selfhosted": awesome_selfhosted,
            "dokploy": github_dir("Dokploy/templates", "blueprints", "Dokploy templates", "new template"),
            "umbrel": github_dir("getumbrel/umbrel-apps", "", "Umbrel app store", "new app"),
            "runtipi": github_dir("runtipi/runtipi-appstore", "apps", "Runtipi app store", "new app")}


def load_state():
    try:
        s = json.load(open(STATE))
    except Exception:
        s = {}
    s.setdefault("seen", {})
    s.setdefault("catalogs", {})
    cutoff = (TODAY - datetime.timedelta(days=KEEP_DAYS)).isoformat()
    s["seen"] = {k: d for k, d in s["seen"].items() if d >= cutoff}
    return s


def save_state(s):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump(s, open(STATE + ".tmp", "w"), indent=1, sort_keys=True)
    os.replace(STATE + ".tmp", STATE)


def known():
    """Repos already proposed, and the names of what we publish or have built."""
    repos, names = set(), set()
    try:
        ps = json.loads(subprocess.run([CTL, "proposals"], capture_output=True, text=True, timeout=60).stdout)["proposals"]
        repos = {k for k in (repo_key(p["url"]) for p in ps) if k}
    except Exception as e:
        sys.exit(f"scout: can't read the proposals inbox ({e}); is dispatcherctl logged in?")
    try:
        ts = json.loads(subprocess.run([CTL, "templates"], capture_output=True, text=True, timeout=60).stdout)
        for t in ts.get("templates", ts) if isinstance(ts, dict) else ts:
            names.add(norm(t["name"].split("|")[0]))
    except Exception:
        pass
    if os.path.isdir(TEMPLATES):
        names |= {norm(d) for d in os.listdir(TEMPLATES) if os.path.isdir(os.path.join(TEMPLATES, d))}
    names.discard("")
    return repos, names


def collect(record_catalogs, state):
    finds, report = {}, []

    def add(item):
        old = finds.get(item["key"])
        if not old:
            finds[item["key"]] = item
            return
        old["sources"] += [s for s in item["sources"] if s not in old["sources"]]
        old["desc"] = old["desc"] or item["desc"]
        old["stars"] = old["stars"] or item["stars"]

    for name, fn in FEEDS.items():
        try:
            items = fn()
            for i in items:
                add(i)
            report.append(f"{name}: {len(items)}")
        except Exception as e:
            report.append(f"{name}: FAILED ({e})")
    for name, fn in CATALOGS.items():
        try:
            entries = fn()
        except Exception as e:
            report.append(f"{name}: FAILED ({e})")
            continue
        before = state["catalogs"].get(name)
        if before is None:
            report.append(f"{name}: first read, {len(entries)} entries, nothing new until one is added")
        else:
            fresh = [k for k in entries if k not in set(before)]
            # A catalog that lost most of its entries was read wrong; don't treat the rest as known.
            if len(entries) < len(before) * 0.5:
                report.append(f"{name}: FAILED (only {len(entries)} of {len(before)} entries came back)")
                continue
            for k in fresh:
                add(entries[k])
            report.append(f"{name}: {len(fresh)} new of {len(entries)}")
        if record_catalogs:
            state["catalogs"][name] = sorted(set(before or []) | set(entries))
    return finds, report


def rank(f):
    gained = max([int(m.group(1).replace(",", "")) for s in f["sources"] for m in [re.search(r"\+([\d,]+) stars", s)] if m] or [0])
    proven = any(s.split(":")[0] in ("Coolify services", "Dokploy templates", "Umbrel app store", "Runtipi app store",
                                     "selfh.st directory", "selfh.st weekly", "awesome-selfhosted") for s in f["sources"])
    places = {s.split(":")[0].split(" (")[0] for s in f["sources"]}  # trending pages count once
    return (-len(places), not proven, -gained, -(f["stars"] or 0))


def fill_in(finds):
    """Description, stars and age for repos a page only linked to, so most can be judged unread."""
    def one(f):
        try:
            r = api("repos/" + f["key"])
        except Exception:
            return
        f["desc"] = f["desc"] or (r.get("description") or "")[:300]
        f["stars"] = r.get("stargazers_count", f["stars"])
        f["created"], f["pushed"] = (r.get("created_at") or "")[:10], (r.get("pushed_at") or "")[:10]
        if r.get("archived"):
            f["archived"] = True
        if r.get("full_name"):
            f["url"] = "https://github.com/" + r["full_name"]
    todo = [f for f in finds if "/" in f["key"] and ":" not in f["key"]]
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        list(pool.map(one, todo))


def main():
    args = sys.argv[1:]
    if args[:1] == ["--commit"]:
        state = load_state()
        for f in json.load(open(args[1]))["finds"]:
            state["seen"][f["key"]] = TODAY.isoformat()
        save_state(state)
        print(f"scout: {len(state['seen'])} finds on record")
        return
    listing = args[:1] == ["--sources"]
    if not listing and len(args) != 1:
        sys.exit(__doc__)
    state = load_state()
    finds, report = collect(not listing, state)
    repos, names = known()
    fresh = [f for k, f in finds.items()
             if k not in state["seen"] and k not in repos and norm(f["name"]) not in names
             and not (f["url"] or "").startswith("https://github.com/two-workspaces/")]
    fresh.sort(key=rank)
    print("\n".join("  " + r for r in report))
    print(f"scout: {len(fresh)} new finds ({len(finds) - len(fresh)} already seen, proposed or published)"
          + (f"; handing over the first {CAP}" if len(fresh) > CAP else ""))
    if listing:
        for f in fresh[:40]:
            print(f"  {f['name'][:28]:28} {str(f['stars'] or ''):>7}  {'; '.join(f['sources'])[:90]}")
        return
    save_state(state)
    fill_in(fresh[:CAP])
    json.dump({"date": TODAY.isoformat(), "sources": report, "finds": fresh[:CAP]}, open(args[0], "w"), indent=1)


if __name__ == "__main__":
    main()

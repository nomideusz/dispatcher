# How Railway ranks template search

Research of 8 November 2026. It covers what Railway's marketplace search matches, how it orders results, and what that means for naming new templates and repairing existing ones.

## The short version

1. **Search matches three fields: the name, the slug and the description.** It does not match the readme, tags, creator or category. Each query word matches the start of a word, so "supa" finds Supabase and "upabase" finds nothing. There is no stemming, no typo tolerance and no stopword list.
2. **The order is a near-strict sort: text tier first, then health band, then running deploys.** The text tiers are:
   1. name *is* the query, or the slug is and the name has the query's words;
   2. name starts with it;
   3. name contains the words;
   4. slug or description only.

   The health bands, best first:
   1. exactly 100;
   2. 70–99;
   3. unscored;
   4. under 70.

   Within the top band, the template with more running deploys ranks first. This rule names the real #1 for 74% of keywords and overlaps the real top four by 80%.
3. **Exact names win the money.** A name or slug equal to the query holds 55% of the deploy-weighted top-four slots and 53% of all #1 slots.
4. **Health has a cliff at 100, not a slope.** 99 ranks the same as 70. Below 70, a template falls under the unscored ones, and it can fall under scored templates a tier or two lower too: our exact-name "Claude Code" at 50 is #22 for "claude code" (see Experiments). A template with no running deploys has no score at all.
5. **Reputation and readme quality don't move rank.** Partner status, creator size and public profile show no effect. Readme length, icon and support health don't either. Verified templates sit higher, but only Railway can verify one.
6. **Most of our gaps are health, not names.** Renaming wins little and often loses keywords that the tagline was earning. The biggest single gains are three moves:
   - getting a score at all: 118 of our 183 listed templates have none;
   - getting from 96 to 100;
   - keeping templates above 70.

The first four positions take 67% of a keyword's deploys: #1 29.7%, #2 17.3%, #3 10.8%, #4 9.0%.

## Data

- **Results:** the top 60 for all 726 Dispatcher keywords, fetched on 8 Nov from `templateSearch`. That gives 12,276 result rows over 668 keywords that returned anything. railway.com/templates calls the same resolver (`templateSearch`, `first: 50`), so this is the order visitors see.
- **Templates:** all 7,776 published templates with every public field: readme, tags, verified and approved flags, maintainer partner profile, creator, health, deploy counts, support health and dates.
- **Rank history:** Dispatcher's `search_ranks` (28 Oct–7 Nov, up to 726 keywords a day, top 20). Joined with hourly `template_snapshots` health, this gives 84 (keyword, our template) series in which health changed.
- **Probes:** about 80 controlled queries, using words that appear in only one field of one template.

**Demand** is Dispatcher's figure: deploys over 90 days of the templates a keyword returns. Railway publishes no search counts, so demand measures interest in what a keyword finds, not how often people type it. Keywords that return the same templates share a figure; "linux desktop *" is one example.

## What is matched

| Field | Matched? | Evidence |
|---|---|---|
| Name | yes | every result |
| Slug (code, split on `-`) | yes | 8 of 8 slug-only words found their template ("wonder" → `hopeful-wonder`) |
| Description | yes | 12 of 12 description-only words found their template |
| Readme | **no** | 0 of 12 readme-only words |
| Tags | **no** | 0 of 8 tag-only words (only 192 templates have tags) |
| Creator name | **no** | 0 of 12 |
| Category | **no** | |

- **Matching rules.** Word prefixes, case-insensitive. "postgre" finds PostgreSQL and "base" finds Baserow, but "base" does not find Supabase. "databases" does not match "database", and "pstgres" finds nothing. "the" is searched like any other word.
- **Multi-word queries.** Templates matching every word come first. After them Railway appends a looser fallback: plain "Redis" for "redis ha", every "Linux Desktop | …" for "linux desktop i3". The fallback rule isn't a simple OR, and it sits below the all-word matches (median relative position 0.63 against 0.42).

So a readme can be written purely for users. Only the name, the slug and roughly the first line of the description (the description field) reach search.

## How results are ordered

### Text tier comes first

Each result is classed by how its name and slug match the query. Only 8.5% of result pairs are out of tier order.

| Tier | Share of results | Median position | In top 4 | Deploy-weighted share of top-4 slots | Share of #1 |
|---|---|---|---|---|---|
| 0. Name or slug equals the query | 8% | 2 | 73% | **55.3%** | 53.3% |
| 1. Name starts with the query | 15% | 11 | 20% | 16.9% | 13.9% |
| 2. Name contains all the words | 21% | 15 | 19% | 13.0% | 20.2% |
| 3. Name has words starting with them | 7% | 15 | 17% | 1.3% | 5.4% |
| 4. Matched only via slug or description | 37% | 25 | 8% | 7.9% | 6.4% |
| 5. Partial match (multi-word fallback) | 12% | 20 | 11% | 5.6% | 0.7% |

- **"Equals" ignores case and punctuation.** "N8N", "n8n" and "n8n." are all exact for `n8n`.
- **A tagline is not part of an exact name.** "Ghost | Publishing Platform" is tier 1 for "ghost". Within tier 1 it ranks no better than "Ghost + MySQL" (coefficient −0.02 ± 0.06).
- **The slug counts like the name, but only when the name has the query's words.** A template whose slug equals the query, hyphens read as spaces, joins tier 0 if its name contains every word of the query. If the name lacks them, the slug is just another slug-only match (tier 3).
  - **Tested 9 Nov.** We moved LiteLLM to `router` and OpenWorker to `autonomous` with their names unchanged ("LiteLLM | AI Gateway for 100+ LLM APIs", "OpenWorker | Open-Source AI Coworker…"). "router" put LiteLLM at #9 and "autonomous" put OpenWorker at #4, below tier-2 names that contain the word even when unscored or at health 0. After the taglines took the word ("LLM Router and AI Gateway…", "Autonomous AI Coworker…"), both were #1 within two minutes, still unscored.
  - Every earlier slug win had the word in the name: `edge` is "Microsoft Edge", `mint` is "Linux Mint", `ssh` is "SSH Bastion".
  - Outside the exact-name tier it ranks #1 in 96% of cases for tier-2 names, and it beats 352 of 403 same-tier rivals in tier 1.
  - **It doesn't beat a tier-2 rival at exactly 100.** On 9 Nov our `ubuntu-terminal` (name "Linux Terminal | Ubuntu Web Shell…", health 96, 139 active) fell to #2 for "ubuntu terminal" under onepush's "Ubuntu Web Terminal" (published 29 Oct, tier 2, health 100, 8 active). The same day `linux-desktop-kde` at 50 still held #1 for "linux desktop kde" over two tier-2 rivals at 96. So an exact slug on a non-exact name sits between tier 0 and tier 2: above 70–99 and lower rivals, below a tier-2 listing at 100.
  - Examples:
    - Rakit's `edge` (named "Microsoft Edge") is #1 for "edge".
    - Our `ubuntu-terminal` and `linux-desktop-kde` are #1 for those phrases at 96% and 33% health.
    - Firecrawl's `firecrawl` is #1 at 88% over an exact-name template at 96%.
- **Slugs are first-come, and they never change after publishing** (`rename.py`: "The code (URL) never changes"). There are 20 templates *named* "n8n" but only one *slug* `n8n`.

### Then the health band

Within tiers 0 and 1 the order is close to deterministic:

| Rule | Tier 0 | Tier 1 |
|---|---|---|
| Band order: 100 → 70–99 → unscored → under 70 | 99.5% of pairs | 99.1% |
| Inside the 100 band, more running deploys first | 100% | 99.6% |
| Inside the middle band, scored before unscored | 96% | 93% |
| Inside the middle band, higher health first | 86% | 88% |

The band shape comes from a pairwise logit fitted within tiers, measured against health 0, with standard errors near 0.03:

| Health | Coefficient |
|---|---|
| exactly 100 | **2.71** |
| 95–99 | 2.05 |
| 90–94 | 1.93 |
| 80–89 | 2.08 |
| 70–79 | 1.71 |
| unscored | 1.90 |
| 60–69 | 0.93 |
| 40–59 | 0.84 |
| 1–39 | 0.61 |

- **70 to 99 is flat.** 80 isn't better than 75, and 99 isn't better than 90.
- **100 is a separate step.** It doubles the odds of ranking above a 70–99 rival.
- **Under 70 is a cliff.** It costs about seven times the odds against 100.

The 11-day panel agrees. Within the same keyword and template, +10 health moved a template 0.79 ± 0.17 positions up, and doubling running deploys moved it about 1.1 positions.

**Health is a live score over running deploys.** Every one of the 3,815 templates with no running deploys is unscored. Of templates with one running deploy, 43% sit at exactly 100. A template that nobody runs therefore ranks with the unscored ones, below every scored 70–99 rival in its tier.

### Tiers 2 to 5 are looser

Inside "name contains the words", the rule explains only 72–78% of pairs. That tier mixes different positions of the word in the name, and the description adds some weight: query words in it help a little, and a longer description hurts a little (0.78× odds per doubling). Inside tier 4, a slug match beats a description-only match 91% of the time.

## What doesn't move rank

All of these were measured within tiers, with health and deploys held constant.

| Factor | Within-tier effect | Note |
|---|---|---|
| Readme length or quality | none (0.96× per doubling) | not searched at all |
| Icon present | none (1.02×) | |
| Creator's number of templates | none (1.02× per doubling) | |
| Creator's total running deploys | none (0.99×) | |
| Partner maintainer (29 templates) | slightly *lower* (0.65×) | the few partners are mostly in loose tiers |
| Public creator profile | can't be tested | `hasPublicProfile` is false for all 7,776 |
| Support health (csat, solved) | can't be tested | set on only 12 templates |
| Total projects ever, recent projects | none once running deploys are in | running deploys (`deploymentCount` in the search node) is what's used |
| Template age | slightly older first (1.10× per doubling) | small |
| Verified (31 templates in results) | higher (2.3×) | granted by Railway, not earnable |

## Where we stand

These figures cover keywords with demand where one of ours appears.

- **Positions.** We appear on 433 such keywords: #1 on 168 and top four on 280.
- **Health.**
  - 36 are at exactly 100.
  - 18 are at 70–99.
  - **118 are unscored**, usually because nothing of theirs is running.
  - 11 are under 70.

We simulated each fix with the rule: tier, then band, then running deploys, against the current rivals. Estimated extra deploys per 90 days use the position curve. Rows from tiers 0–1 are reliable. Tier-2 rows are marked †.

| Keyword | Demand | Ours now | Health → 100 gives | Template, health, running |
|---|---|---|---|---|
| ssh † | 5,277 | #10 | #1, +1,360 | Linux Terminal, 96, 130 |
| hermes | 6,522 | #29 | #8, +386 | Hermes Agent Dashboard, 80, 3 |
| n8n | 3,851 | #21 | #8, +228 | n8n (`n8n-queue`), unscored, 0 |
| terminal † | 1,117 | #3 | #1, +212 | Linux Terminal |
| hermes agent | 5,180 | #25 | #18, +202 | Hermes Agent Dashboard |
| microsoft / microsoft edge | 732 / 652 | #6 / #3 | #1, +168 / +124 | Microsoft Edge, 96, 566 |
| evolution | 2,062 | #21 | #5, +156 | Evolution API with n8n, 96, 27 |
| wordpress pro / wordpress | 415 / 622 | #2 / #9 | #1 / #4 | WordPress, unscored, 0 |
| postiz | 241 | #4 | #1, +50 | Postiz, 92, 5 |
| paperclip, ollama, searxng search, typebot, metabase, open webui litellm | 120–200 each | #2–#7 | #1–#2, +15–48 each | all unscored, 0 running |
| minecraft java | 148 | #4 | #1, +31 | Minecraft Server, **0**, 2 |
| chromium | 140 | #3 | #1, +27 | Chromium, **55**, 36 |
| twenty crm | 265 | #5 | #2, +26 | Twenty CRM, 88, 4 |
| firefox | 81 | #4 | #1, +17 | Firefox, **38**, 11 |

Over all keywords, the tier 0–1 health fixes sum to about **1,800 deploys per 90 days**, or about 3,700 with the tier-2 rows. Keywords that share results are counted once per template.

Size doesn't stop a template reaching exactly 100. The score covers at most the 25 most recent deploys: over 14 days Edge (578 running) and Linux Terminal (146) only took multiples of 4, while templates with fewer recent deploys take other fractions (Chromium 55, 58, 64). One broken deploy among the latest 25 costs 4 points until 25 newer ones replace it, so a busy template can return to 100 within days and lose it again just as fast (Linux Terminal: 60 for weeks before its 30 Oct switch to a prebuilt image, 100 on 7 Nov, 96 from a deploy burst on 8 Nov). For ours with 0 running, the first healthy running deploy is the whole gap.

### Renames mostly don't pay

We simulated cutting each tagline down to the app name ("Linux Terminal | Ubuntu Web Shell + SSH + tmux" → "Linux Terminal") across all of that template's keywords.

- **Gains are small.** The best is the Linux Desktop family, at +70 to +141 each for "linux desktop", but seven of them compete for the same #1, so the gains can't be added up.
- **Losses can be large.** The tagline is what wins the generic word:
  - Linux Terminal −591 ("ssh" #3 → #21);
  - Codewhale −409;
  - Obsidian −129 and Blender −75 ("desktop");
  - Pterodactyl −39 ("game server" #1 → #8).

This matches the 5 Nov Twenty rename, which was reverted after "twenty crm" fell from #5 to #10. A tagline costs the app-name keyword one tier, from exact to starts-with. It pays when the generic words in it have more demand than the app's own name.

## Playbook

### Before publishing a new template

1. **Pick the slug first; it's permanent.**
   - If the app's bare slug is free (`ghost`, `metabase`), take it. That is tier 0 for the app's name forever, as long as the name keeps the app's name.
   - Otherwise, use the slug for the highest-demand multi-word query, such as `ubuntu-terminal` or `linux-desktop-kde`. An exact slug ranks #1 for that phrase in almost every case.
   - Never accept `-1`, `-production` or random slugs if a meaningful one is free. Our `n8n-queue`, `postiz-production` and `metabase-production` match no query exactly.
   - A slug on a generic word needs that word in the name too ("SSH Bastion" on `ssh`), or it ranks as a slug-only match.
   - A slug can be moved later on the same template, keeping its ID and history: unpublish it, publish it under a temporary name equal to the target word (Railway mints the code again from the name), then rename it back and republish if the image was dropped. `~/dev/railway-templates/reslug.py DIR TEMPNAME` does this. Publishing after an unpublish under the old name collides with the template's own old code and gives `-1` (`terminal` became `terminal-1` on 9 Nov). An unpublished template keeps its code against everyone else.
2. **Name it exactly the app's name when the app is the search term**: "Ghost", not "Ghost CMS + MySQL". Each extra word drops the app-name keyword from tier 0 to tier 1.
3. **Add a tagline only to win a bigger generic word.** "| Web Shell + SSH" earns "ssh" (5,277) in tier 2. Check the generic word's demand on Dispatcher's Search page against the app name's before deciding.
4. **Put second keywords in the description, and keep it short.** It is matched, and short descriptions rank slightly better. Spend no effort on readme keywords; the readme isn't searched.
5. **Read tier 0 before building.** Count the exact-name and exact-slug templates at 100 for the keyword. If there are three or more with many running deploys, we start at #(n+1) at best, and only overtake them when our running count passes theirs. If tier 0 is empty or full of unscored and sub-70 templates, a healthy exact-name template takes #1.
6. **Get it running and scored quickly.** Unscored ranks below every scored 70–99 rival in the top tiers.

### For existing templates

1. **Move templates to exactly 100.** Start with the table above: Hermes Agent Dashboard, Evolution API, Postiz and Twenty CRM. 96 and 80 rank the same, so a partial fix earns nothing until it reaches 100.
2. **Rescue anything under 70 first**: Minecraft Server at 0, Firefox at 38, Chromium at 55, and since 9 Nov Claude Code at 50, Linux Desktop at 54 and Linux Desktop KDE at 50. Under 70, a template sits below unscored ones, and even an exact name doesn't save it.
3. **Give unscored templates a score, through other people's deploys.** 118 of ours rank as unscored. Our own deploy doesn't count: tested 8–9 Nov (below), three held canaries left their templates unscored with 0 active projects for 29 hours. A score needs at least one active project made by someone else, and even that isn't always enough (7 of ours had 1–3 active and no score). So the lever is getting the first outside deploy (name, slug, description, README), not holding a canary.
4. **Don't rename for search** unless the simulation for that template, across all its keywords, comes out positive. The slug can't change at all.

## Experiments, 8–9 November

We published four templates on free slugs and edited three descriptions to test the rule on live listings. `search-ranking/score_probe.py` re-runs the queries hourly into `probe-log.jsonl` (`python score_probe.py --show` prints them).

| Change | Query | Result | Rule it tests |
|---|---|---|---|
| "Linux" (`linux`), published 8 Nov ~14:05 UTC | linux | #1 while unscored with 0 running, above Linux Terminal and four Linux Desktops at 96 | tier 0 beats tier 1 whatever the health band |
| | linux ssh | #3, below `kali-linux-ssh` (25) and `arch-linux-ssh` (17) | tier beats health even under 70 |
| "Fedora" (`fedora-linux`), 8 Nov ~15:00 | fedora | #1 while unscored, above the exact-slug `fedora` at 33 | inside tier 0, unscored ranks above under 70 |
| "Linux Mint" (`linux-mint`), 9 Nov ~02:25 | linux mint, mint desktop | #1 | exact name is tier 0 |
| | mint | #3, below "thirdweb: NFT Minting Page" (56) and `vusd-mint` | tiers 2–5 are loose (see below) |
| Same template republished as `mint`, 9 Nov ~02:40 | mint | #1 within minutes, above thirdweb (56) | exact slug plus the word in the name is tier 0 |
| "SSH Bastion" (`ssh`), 9 Nov ~03:00, a new key-only jump host | ssh | #1 within minutes while unscored, above `termix-ssh` (100) and others; Linux Terminal had been #10 | exact slug is tier 0 on a 5,328-demand word nobody held |
| | ssh bastion, bastion, jump host | #1, the only result | |
| "Terminal" (`terminal`), 9 Nov ~12:10, a browser shell inside a project's private network | terminal | #1, above Linux Terminal (#4 that morning) | exact name is tier 0 |
| Zero-deploy templates moved in place: Open WebUI → `chat-gpt`, Magento → `magento`, 9 Nov ~13:05 | chat gpt; magento | #1 (rivals were tier 2 at health 0 and tier 3); #2 (was #4), below the exact-name "Magento" at 79 | slug with the word in the name joins tier 0, then the band decides |
| LiteLLM → `router`, OpenWorker → `autonomous`, names unchanged | router; autonomous | #9; #4, below unscored tier-2 names | slug without the word in the name is only tier 3 |
| Same two, taglines now "LLM Router and AI Gateway…", "Autonomous AI Coworker…" | router; autonomous | #1 and #1 within two minutes | the name must carry the word |
| "Kubuntu", "Xubuntu", "Lubuntu" added to the descriptions of `linux-desktop-kde`, `linux-desktop`, `linux-desktop-lxqt` | kubuntu, xubuntu, lubuntu | each the only result for its word | descriptions are searched |

What these add:

- **Indexing takes minutes.** "Linux" ranked within about 5 minutes of publishing, and edited descriptions were searchable by the next hourly probe.
- **Words of a multi-word query may come from different fields.** "linux server" returns "Linux" as its only result: "linux" is in the name and "server" only in the description.
- **An unscored template can hold #1 when its tier has no scored rival.** "Linux" and "Fedora" did, at 0 running. Playbook step 6 matters only when a 70–99 rival shares the tier.
- **The "mint" result doesn't move the 70 cutoff.** thirdweb's name has "Minting" and its description starts with "Mint", so this is a loose-tier comparison where the band rule explains only 72–78% of pairs.
- **We missed the playbook's first step once, then fixed it.** `mint` was free on 9 Nov, but we first published as `linux-mint`. Named "Linux Mint", a `mint` slug is tier 0 for both "mint" and "linux mint", so we republished it as `mint` and deleted `linux-mint` while it had 0 deploys.
- **Two of ours are under 70.** Linux Desktop (Ubuntu XFCE) is at 54 with 30 running, and Linux Desktop KDE moved from 33 to 50. Neither was on the rescue list above. Fedora KDE was OOM-killed four times while idle at 512 MB during testing, which is the likely cause for KDE.

- **Many generic slugs are free.** A scan of all 728 Dispatcher keywords on 9 Nov found a free exact slug for 76 of the top 221 by demand, including `ssh`, `terminal`, `shell`, `web-terminal`, `desktop`, `vps` and `file-browser` (a rescan of the top 300 that afternoon found 104). Claiming one only pays if the template's name can carry the word. Demand here is deploys of what a keyword returns, so `cursor` and `router` look big only because of templates further down their results.

- **Under 70 costs more than the tier.** Our "Claude Code" (exact name and slug `claude-code`, tier 0) sits at health 50 with 5 running. It ranks #22 for "claude code", below tier-1 and tier-2 templates at 80–100 and some unscored ones, and #13 for "claude". Debian at 0 sits at #18 for "linux terminal". The opposite case also holds: `kali-linux-ssh` (25, name has both words) beats our unscored "Linux" (only "ssh" in the description) for "linux ssh". So under 70 is a penalty of a tier or two, not a fixed floor below every healthy template.
- **An exact slug wins #1 only where the tier is empty or weak.** As of 9 Nov:
  - `router`, `claude` and `evolution` were free, with no exact-name template, so an unscored newcomer would be #1. We took `router` for LiteLLM the same day (see the experiments table).
  - `hermes` was taken, and its tier 0 already held three templates: "Hermes" at 100 (16 running), Hermes Agent at 88 (239) and "Hermes" at 76 (1,403).
  - "evolution api", the query people type, has six exact-name templates led by one at 100 with 5,426 running. `evolution` would win only the bare word.

- **Our own deploy doesn't give a score.** On 8 Nov 06:05–06:07 UTC we deployed `searxng-search`, `umami-web-analytics` and `wordpress-pro` from their published codes and held them, all passing. Through the last probe at 9 Nov 10:44 UTC (21 readings, 29 hours) all three stayed unscored with 0 active projects, and their ranks didn't move ("wordpress" #9, "wordpress pro" #2, "searxng" #2, "searxng search" #3, "umami" #7). Railway's project counts leave out the creator's own deploys, and so does the score. The canaries were deleted on 9 Nov.

Still running:

- **"Linux" stays undeployed until ~10 Nov 14:00 UTC.** The own-deploy question it was meant to answer is settled above, so no owner deploy is needed.
- **14 days organic after that.** Compare Linux's deploys with Linux Terminal's previous 14 days to see whether it adds deploys or takes them from Linux Terminal.

## Limits

- **Ranking order** comes from one day's snapshot, so the rule describes the current ranker. It explains tiers 0–1 almost fully and tiers 2–5 only loosely.
- **Causal evidence** comes only from the 11-day panel (84 series), the Twenty rename and the LibreOffice rename. Everything else is cross-sectional.
- **Demand** counts deploys of what a keyword returns, not searches. Results for "word" were WordPress deploys, for example.
- **Simulated gains** assume rivals stand still and that our running count stays the same.
- **The fallback rule** for multi-word queries is still unknown.

## Reproducing

The scripts are in [`search-ranking/`](search-ranking/).

- `fetch_market.py` pulls all templates; `fetch_serp.py` pulls the top 60 per keyword. Stay under Railway's limit, roughly 1 request every 0.7 s; faster gets "You are querying the template marketplace too fast".
- `feat.py` builds the features; `final.py`, `final2.py` and `lex.py` fit the tiers and bands; `panel.py` runs the rank-history panel; `sim.py` and `rename_sim.py` run the what-ifs.
- The scripts need a copy of the prod DB with its WAL (see the Railway template health memory) and a Python environment with pandas, statsmodels and scikit-learn.
- They read their inputs from the working directory:
  - `market.json` and `serp.json` from the two fetchers;
  - `db/d.duckdb`, the prod DB copy;
  - `../search.json`, the `/api/search` response via `dispatcherctl --compact get search`.
- `lex.py`, `sim.py` and `rename_sim.py` read the pickles that `final.py` and `final2.py` write.

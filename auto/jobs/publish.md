Publish the template drafts the owner approved.

The approved list is `~/dev/railway-templates/publish-approved.txt`, one directory per line; `python3 -I ~/dev/apps/dispatcher/auto/approved.py` (run from `~/dev/railway-templates`) says which are waiting and how many slots are free. Publish only directories on that list, oldest draft first, and only as many as there are free slots.

For each one, follow `~/dev/railway-templates/PUBLISHING.md`:
1. Confirm the slug its `short_name` mints is still unclaimed (`/deploy/SLUG?x=1` is 404 and gql `template(code:)` says "Template not found"). If someone took it, do not publish: report it and leave it on the list.
2. `python3 publish.py DIR`. Never use or repeat Railway's revalidate secret if an error shows it.
3. Check the minted code and the final name on the marketplace, point the README's deploy button at the real code if it differs, push, and run `publish.py DIR` again so the listing matches.
4. Add the `railway-template` topic to the repo.
5. `./canary.py DIR`, and with `LIMIT_GB=0.5` and `LIMIT_GB=1` unless the template's memory note says it needs more. A canary that fails after publishing goes in the report as the first item; do not unpublish.
6. In Dispatcher: `dispatcherctl kind ID KIND`, `dispatcherctl origin ID original|competitive`, track its keywords, mark its candidate group `skip "Built as CODE"`, and answer its proposal with `published` and the code if it came from Proposals.
7. Remove the directory from `publish-approved.txt`, and update its memory note and MEMORY.md line (published date, code, day-0 search position from `opening.py`).

Publish nothing that is not on the list, even a tested draft. Report what was published (name, code, URL, day-0 position, canary result) and what stayed on the list and why. If a PushNotification tool is available, send one line with the same.

Read the template upgrade queue and report. Push nothing.

Follow the Upgrades bullet in `.claude/skills/routine/SKILL.md` and `.claude/skills/upgrades/SKILL.md` as far as reading goes: `python3 -I .claude/skills/routine/check.py --only upgrades`, then for every template with running instances that is behind, read the release notes between our tag and the latest.

You may record an urgent finding with `dispatcherctl urgent ID "REASON"` (a CVE, an advisory, an auth or permission bypass, or a fix for something our version breaks on). That is the only write this run makes. Do not edit template directories, push, publish, redeploy, or record `upgraded` or `fixed`.

Report: urgent ones first (most running instances first) with the reason and the target version; then the batch you would push this week in order, marking each as patch/minor (safe to push once its canary passes) or major / data migration / new memory floor (needs the owner); then anything held and why (a release days old with an open regression report). If a PushNotification tool is available, send one line: how many urgent, how many in this week's batch.

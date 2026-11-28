#!/bin/bash
# Unattended Dispatcher jobs on this machine. hp starts them over SSH with a key that can
# run nothing else (authorized_keys: command="…/auto/run.sh"), so the job name arrives in
# SSH_ORIGINAL_COMMAND; by hand: auto/run.sh JOB.
#   ping      answer "ok" (hp uses it to see whether the machine is up)
#   idle      "idle" when nobody is logged in at the desk and no Claude session runs
#   doctor    which logins the jobs can use right now
#   status    the latest report of each job
#   scout     new apps from discovery sources → proposals    (scout.py, jobs/scout.md)
#   monitor   read-only routine check                        (jobs/monitor.md)
#   build     candidates → tested drafts, never published    (jobs/build.md)
#   publish   publish drafts the owner approved              (jobs/publish.md)
#   upgrades  read the upgrade queue, report only            (jobs/upgrades.md)
set -u
JOB="${SSH_ORIGINAL_COMMAND:-${1:-}}"
REPO="$HOME/dev/apps/dispatcher"
AUTO="$REPO/auto"
TEMPLATES="$HOME/dev/railway-templates"
STATE="$HOME/.local/state/dispatcher-auto"
mkdir -p "$STATE/logs" "$AUTO/reports"

export PATH="$HOME/.local/bin:$HOME/go/bin:$HOME/.local/share/fnm:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"
command -v fnm >/dev/null 2>&1 && eval "$(fnm env --shell bash 2>/dev/null)"
# A session started over SSH has no desktop bus address; gh keeps its token in the keyring.
: "${XDG_RUNTIME_DIR:=/run/user/$(id -u)}"; export XDG_RUNTIME_DIR
[ -S "$XDG_RUNTIME_DIR/bus" ] && export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

others() { pgrep -u "$(id -u)" -f '(^|/)claude( |$)' | wc -l; }
desk_session() { # someone using the machine: a desktop login (not the greeter) or an SSH terminal
  local s
  for s in $(loginctl list-sessions --no-legend 2>/dev/null | awk '{print $1}'); do
    [ "$(loginctl show-session "$s" -p Class --value 2>/dev/null)" = user ] || continue
    if [ "$(loginctl show-session "$s" -p Remote --value 2>/dev/null)" = yes ]; then
      [ "$(loginctl show-session "$s" -p Type --value 2>/dev/null)" = tty ] && return 0 # hp's job key gets no terminal
      continue
    fi
    case "$(loginctl show-session "$s" -p Type --value 2>/dev/null)" in wayland | x11) return 0 ;; esac
  done
  return 1
}
gh_ok() { timeout 20 gh auth status >/dev/null 2>&1; }

case "$JOB" in
  ping) echo ok; exit 0 ;;
  idle)
    if desk_session; then echo "busy: someone is logged in"
    elif [ "$(others)" -gt 0 ]; then echo "busy: a Claude session is running"
    elif [ -e "$STATE/lock" ] && ! flock -n "$STATE/lock" true; then echo "busy: a job is running"
    else echo idle; fi
    exit 0 ;;
  doctor)
    command -v claude >/dev/null && echo "claude: $(claude --version 2>&1 | head -1)" || echo "claude: MISSING"
    gh_ok && echo "github: ok" || echo "github: LOCKED (the token is in the desktop keyring; log in at the desk, or store it in a file)"
    timeout 30 "$HOME/go/bin/dispatcherctl" templates >/dev/null 2>&1 && echo "dispatcher: ok" || echo "dispatcher: NOT LOGGED IN (dispatcherctl login)"
    timeout 30 railway whoami >/dev/null 2>&1 && echo "railway: ok" || echo "railway: NOT LOGGED IN"
    (cd "$TEMPLATES" && python3 publish.py --slots 2>&1 | head -1)
    exit 0 ;;
  status)
    for j in scout monitor build publish upgrades; do
      f=$(ls -t "$AUTO/reports/"*"-$j.md" 2>/dev/null | head -1)
      [ -n "$f" ] && { echo "== $j: $(basename "$f")"; head -12 "$f"; echo; } || echo "== $j: no report yet"
    done
    exit 0 ;;
  scout) LIMIT=60m; WAIT=7200; NEEDS_GH=0 ;;
  monitor) LIMIT=45m; WAIT=7200; NEEDS_GH=0 ;;
  build) LIMIT=5h; WAIT=7200; NEEDS_GH=1 ;;
  publish) LIMIT=3h; WAIT=0; NEEDS_GH=1 ;;
  upgrades) LIMIT=90m; WAIT=7200; NEEDS_GH=0 ;;
  *) echo "unknown job: '$JOB' (ping idle doctor status scout monitor build publish upgrades)"; exit 2 ;;
esac

stamp=$(date +%F-%H%M)
report="$AUTO/reports/$stamp-$JOB.md"
log="$STATE/logs/$stamp-$JOB.log"
say() { echo "$(date '+%F %T') $*" | tee -a "$log"; }

# Cheap checks first, so a run with nothing to do costs no model time.
if [ "$JOB" = publish ]; then
  todo=$(cd "$TEMPLATES" && python3 -I "$AUTO/approved.py" 2>&1); rc=$?
  if [ $rc -ne 0 ]; then say "publish: $todo"; exit 0; fi
  say "publish: $todo"
fi
if [ "$NEEDS_GH" = 1 ] && ! gh_ok; then
  msg="$JOB skipped: the GitHub login is locked. It lives in the desktop keyring, which opens when you log in at the desk."
  say "$msg"; printf '# %s %s\n\n%s\n' "$JOB" "$stamp" "$msg" > "$report"; exit 3
fi

exec 9>"$STATE/lock"
if ! flock -w "$WAIT" 9; then say "$JOB skipped: another job holds the lock"; exit 75; fi

extra=""
if [ "$JOB" = scout ]; then
  finds="$STATE/scout-finds.json"
  if ! out=$(cd "$REPO" && python3 -I "$AUTO/scout.py" "$finds" 2>&1); then
    say "scout: collecting failed: $out"; printf '# scout %s\n\nCollecting failed:\n\n%s\n' "$stamp" "$out" > "$report"; exit 1
  fi
  say "$out"
  if printf '%s' "$out" | grep -q '^scout: 0 new finds'; then exit 0; fi
  extra="
The finds file is $finds."
fi

prompt="$(cat "$AUTO/jobs/$JOB.md")$extra

Today is $(date +%F) ($(date +%A)), local time $(date +%H:%M) $(date +%Z). This is an unattended run started by a timer: nobody is reading along and nobody can answer a question. Your final message is saved as the report at $report, so make it the whole report."
say "starting $JOB (limit $LIMIT)"
cd "$REPO" || exit 1
timeout --signal=TERM --kill-after=120 "$LIMIT" \
  claude -p "$prompt" --permission-mode bypassPermissions --output-format text --name "auto-$JOB-$stamp" \
  > "$report.tmp" 2>> "$log"
rc=$?
{ printf '# %s %s\n\n' "$JOB" "$stamp"
  [ $rc -eq 124 ] && printf '**Stopped at the %s time limit; what follows may be incomplete.**\n\n' "$LIMIT"
  [ $rc -ne 0 ] && [ $rc -ne 124 ] && printf '**The run ended with exit code %s; see %s.**\n\n' "$rc" "$log"
  cat "$report.tmp"; } > "$report"
rm -f "$report.tmp"
[ "$JOB" = scout ] && [ $rc -eq 0 ] && say "$(python3 -I "$AUTO/scout.py" --commit "$finds" 2>&1)"
say "$JOB ended with $rc; report $report"
exit $rc

#!/bin/bash
# Run on hp, from the synced repo: ~/dev/apps/dispatcher/auto/hp/install.sh
# Installs the script and the timers for the current user and starts the timers.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
[ -f "$HOME/.ssh/dispatcher_auto" ] || ssh-keygen -q -t ed25519 -N '' -C 'hp->pop dispatcher-auto' -f "$HOME/.ssh/dispatcher_auto"
conf="$HOME/.config/dispatcher-auto.conf"
[ -f "$conf" ] || { mkdir -p "$HOME/.config"; printf '# Address of pop-os, the MAC of its wake-on-LAN port, and the broadcast address to send to.\nPOP=\nMAC=\nBROADCAST=\n# POWEROFF_AFTER=0 keeps pop-os on after a job hp woke it for.\n' > "$conf"; echo "fill in $conf"; }
install -D -m 0755 "$here/dispatcher-auto" "$HOME/.local/bin/dispatcher-auto"
mkdir -p "$HOME/.config/systemd/user"
cp "$here"/dispatcher-auto@.service "$here"/dispatcher-auto-*.timer "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
for t in "$here"/dispatcher-auto-*.timer; do systemctl --user enable --now "$(basename "$t")"; done
systemctl --user list-timers --no-pager 'dispatcher-auto-*'
echo "public key for pop-os authorized_keys:"; cat "$HOME/.ssh/dispatcher_auto.pub"

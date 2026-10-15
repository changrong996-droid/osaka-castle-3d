#!/bin/bash
# Usage: goal/mac.sh '<command run in ~/Hark/osaka-castle-3d on the Mac>' [@remote_rel_path ...]
# Syncs the repo (minus out/ and goal/refs) to the Mac first. Downloads go to castle/dl/.
set -e
REPO=/workspace/projects/3dffd53e-9285-4461-aa69-4f5634f0e079/castle
pip install -q pysocks paramiko >/dev/null 2>&1 || true
cd /workspace/work/ts
[ "$(stat -c%s state/tailscaled.state 2>/dev/null || echo 0)" -lt 100 ] && cp state_backup/tailscaled.state state/
pgrep tailscaled >/dev/null || { (./tailscaled --tun=userspace-networking --socks5-server=localhost:1055 --statedir=$PWD/state --socket=$PWD/ts.sock > tsd.log 2>&1 &); sleep 8; }
cd "$REPO" && tar czf /workspace/work/ts/mv/castle_repo.tgz --exclude=out --exclude=dl --exclude=goal/refs --exclude=.git .
CMD="$1"; shift
DL=()
for a in "$@"; do DL+=("@$(basename "$a")"); CMD="$CMD; cp ~/Hark/osaka-castle-3d/$a ~/Hark/mv_f35b/ 2>/dev/null || true"; done
cd /workspace/work/ts/mv
python3 rx.py "mkdir -p ~/Hark/osaka-castle-3d && tar xzf castle_repo.tgz -C ~/Hark/osaka-castle-3d && cd ~/Hark/osaka-castle-3d && $CMD" castle_repo.tgz "${DL[@]}"
mkdir -p "$REPO/dl"; for a in "$@"; do mv -f "/workspace/work/ts/mv/$(basename "$a")" "$REPO/dl/" 2>/dev/null || true; done

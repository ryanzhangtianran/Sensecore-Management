#!/usr/bin/env bash
# Stream offline W&B runs written by an ACP task (the cluster has no internet) to W&B from a box that can reach it,
# e.g. your CCI through its local proxy. Uses `wandb beta sync --live` (needs a recent wandb; 0.24 cannot sync to
# wandb.ai). Stops after the training log shows DONE_RE, or once the log has not changed for STALE_MIN minutes
# (task died: --live would hang forever on a run that never writes its exit record).
# On AFS, --live exits with "block appears to be zeroed"/"checksum mismatch" when it catches up with the
# half-written tail; that is expected. The loop restarts it every INTERVAL and it resumes from the uploaded step.
#
# Usage: wandb-sync.sh <wandb-dir> <key-file> <training-log> [done-regex]
#   <wandb-dir>  the WANDB_DIR the training used (it contains wandb/offline-run-*)
#   <key-file>   file holding the W&B API key, on the box running this script
# Env: WANDB_BIN (default: wandb on PATH), PROXY (default http://127.0.0.1:7890),
#      INTERVAL check seconds (default 60), STALE_MIN (default 30)
# Run it inside tmux on the CCI so it survives your SSH session:
#   tmux new -d -s wandb-sync "bash wandb-sync.sh ... 2>&1 | tee -a <wandb-dir>/sync.log"
set -euo pipefail

[ $# -ge 3 ] || { sed -n '7,13p' "$0" >&2; exit 2; }
dir=${1%/} key=$2 log=$3 done_re=${4:-TRAIN DONE}
bin=${WANDB_BIN:-wandb}
interval=${INTERVAL:-60}
stale=${STALE_MIN:-30}
[ -s "$key" ] || { echo "missing key file $key" >&2; exit 1; }
export HTTPS_PROXY=${PROXY:-http://127.0.0.1:7890} HTTP_PROXY=${PROXY:-http://127.0.0.1:7890}
WANDB_API_KEY=$(<"$key"); export WANDB_API_KEY

# shortcut: streams only the newest run dir; a resubmit (new offline-run-* with the same id) is picked up when
# the previous stream exits, which is fine for one task per wandb-dir.
newest() { ls -1td "$dir"/wandb/offline-run-* 2>/dev/null | head -1 || true; }
pid=
start() {
  local run; run=$(newest)
  [ -n "$run" ] || { echo "$(date +%T) no offline runs yet"; return 0; }
  echo "$(date +%T) live sync $run"
  "$bin" beta sync --live --no-skip-synced "$run" & pid=$!
}
finish() { # $1 = exit code
  [ -n "$pid" ] && kill "$pid" 2>/dev/null; wait 2>/dev/null || true
  local run; run=$(newest); [ -n "$run" ] && "$bin" beta sync --no-skip-synced "$run" || true
  exit "$1"
}
trap 'finish 130' INT TERM

while :; do
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || start
  if [ -f "$log" ] && grep -qE "$done_re" "$log"; then
    # the run's exit record ends --live on its own; give it a few minutes before forcing a final pass
    for _ in $(seq 30); do kill -0 "$pid" 2>/dev/null || break; sleep 10; done
    echo "$(date +%T) training done"; finish 0
  fi
  if [ -f "$log" ] && [ -n "$(find "$log" -mmin +"$stale")" ]; then
    echo "$(date +%T) $log unchanged for ${stale} min, assuming the task ended"; finish 1
  fi
  sleep "$interval"
done

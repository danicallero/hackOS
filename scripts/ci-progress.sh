#!/usr/bin/env bash
# #1283: give every CI command a live heartbeat while preserving its exit status.
set -u

label="${CI_PROGRESS_LABEL:-${GITHUB_JOB:-local}/${GITHUB_ACTION:-command}}"
remaining="${CI_PROGRESS_REMAINING:-See the remaining steps in this job Actions timeline}"
started=$SECONDS
log() { printf '[ci %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
log "START $label; remaining afterward: $remaining"
log "Runner CPUs: $(getconf _NPROCESSORS_ONLN)"

(
  while true; do
    sleep 30
    log "RUNNING $label; elapsed=$((SECONDS - started))s; remaining afterward: $remaining"
    if command -v uptime >/dev/null; then uptime; fi
    if command -v free >/dev/null; then free -m; fi
  done
) 2>/dev/null &
monitor_pid=$!
cleanup() {
  # Stop the monitor's pending sleep as well, so it cannot outlive the command.
  pkill -P "$monitor_pid" 2>/dev/null || true
  kill "$monitor_pid" 2>/dev/null || true
  wait "$monitor_pid" 2>/dev/null || true
}
trap cleanup EXIT

bash --noprofile --norc -e -o pipefail "$1"
command_exit=$?
log "END $label; exit=$command_exit; elapsed=$((SECONDS - started))s; remaining afterward: $remaining"
exit "$command_exit"

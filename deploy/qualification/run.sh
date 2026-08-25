#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/deploy/qualification/docker-compose.yml"
PROJECT_NAME="hackos-event-day-qualification"
RELEASE_IMAGE="${RELEASE_IMAGE:-}"
ARTIFACT_DIR="${QUALIFICATION_ARTIFACT_DIR:-$ROOT_DIR/artifacts/event-day-qualification}"
DURATION_SECONDS="${QUALIFICATION_DURATION_SECONDS:-10}"
if [[ "$ARTIFACT_DIR" != /* ]]; then
  ARTIFACT_DIR="$PWD/$ARTIFACT_DIR"
fi
export RELEASE_IMAGE QUALIFICATION_ARTIFACT_DIR="$ARTIFACT_DIR"

die() { printf 'qualification preflight failed: %s\n' "$*" >&2; exit 2; }
[[ "$RELEASE_IMAGE" =~ @sha256:[a-f0-9]{64}$ ]] || \
  die 'RELEASE_IMAGE must be an immutable @sha256:<64 hex> release image.'
[[ "$DURATION_SECONDS" =~ ^[1-9][0-9]*$ ]] || die 'QUALIFICATION_DURATION_SECONDS must be a positive integer.'
command -v docker >/dev/null 2>&1 || die 'docker is required.'
[[ -f "$COMPOSE_FILE" ]] || die "compose file is missing: $COMPOSE_FILE"

# A production DATABASE_URL in the caller's shell is a stop condition, not an
# env var to silently ignore. The compose file has its own fixed DB URL
# (H22-H42, H46, #544).
[[ -z "${DATABASE_URL:-}" ]] || die 'DATABASE_URL is set in the caller; unset it before qualification.'
[[ -z "${VALKEY_URL:-}" ]] || die 'VALKEY_URL is set in the caller; unset it before qualification.'
[[ "$ARTIFACT_DIR" != *..* ]] || die "artifact directory cannot contain '..': $ARTIFACT_DIR"

case "$ARTIFACT_DIR" in
  /|"$ROOT_DIR"|"$ROOT_DIR/"|/var/lib/docker|/var/lib/docker/)
    die "artifact directory is too broad: $ARTIFACT_DIR"
    ;;
esac
mkdir -p "$ARTIFACT_DIR"
RESULT_PATH="$ARTIFACT_DIR/result.json"
rm -f "$RESULT_PATH"

compose=(docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE")
QUALIFICATION_ARTIFACT_DIR="$ARTIFACT_DIR" RELEASE_IMAGE="$RELEASE_IMAGE" \
  "${compose[@]}" config --format json | \
  node "$ROOT_DIR/deploy/qualification/validate-compose.mjs" "$RELEASE_IMAGE"

# This cleanup is scoped to the fixed Compose project and its project-scoped
# qualification volume; it cannot target the production project or volumes.
"${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
status=0
cleanup() {
  local exit_status=$?
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  exit "$exit_status"
}
trap cleanup EXIT INT TERM

QUALIFICATION_ARTIFACT_DIR="$ARTIFACT_DIR" RELEASE_IMAGE="$RELEASE_IMAGE" \
  "${compose[@]}" up -d --wait --wait-timeout 90 postgres valkey
QUALIFICATION_ARTIFACT_DIR="$ARTIFACT_DIR" RELEASE_IMAGE="$RELEASE_IMAGE" \
  "${compose[@]}" run --rm --no-deps runner \
  node dist/event-day-load.js --mode prepare --fixture /artifacts/fixture.json

QUALIFICATION_ARTIFACT_DIR="$ARTIFACT_DIR" RELEASE_IMAGE="$RELEASE_IMAGE" \
  "${compose[@]}" up -d --wait --wait-timeout 90 api
QUALIFICATION_ARTIFACT_DIR="$ARTIFACT_DIR" RELEASE_IMAGE="$RELEASE_IMAGE" \
  "${compose[@]}" up -d worker

set +e
QUALIFICATION_ARTIFACT_DIR="$ARTIFACT_DIR" RELEASE_IMAGE="$RELEASE_IMAGE" \
  "${compose[@]}" run --rm --no-deps runner \
  node dist/event-day-load.js --mode load \
  --base-url http://api:3000 \
  --fixture /artifacts/fixture.json \
  --duration-seconds "$DURATION_SECONDS" \
  --output /artifacts/result.json
status=$?
set -e

if [[ -f "$RESULT_PATH" ]]; then
  printf 'qualification artifact: %s\n' "$RESULT_PATH"
else
  printf 'qualification runner did not write %s\n' "$RESULT_PATH" >&2
  if [[ "$status" -eq 0 ]]; then
    status=1
  fi
fi
exit "$status"

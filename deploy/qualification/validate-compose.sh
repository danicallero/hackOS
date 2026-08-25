#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/deploy/qualification/docker-compose.yml"
RELEASE_IMAGE="${RELEASE_IMAGE:-}"
if [[ ! "$RELEASE_IMAGE" =~ @sha256:[a-f0-9]{64}$ ]]; then
  printf '%s\n' 'Set RELEASE_IMAGE to an immutable @sha256:<64 hex> release image.' >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' 'docker is required for qualification compose validation.' >&2
  exit 2
fi

TEMP_ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hackos-event-day-qualification.XXXXXX")"
cleanup() { rmdir "$TEMP_ARTIFACT_DIR" 2>/dev/null || true; }
trap cleanup EXIT

QUALIFICATION_ARTIFACT_DIR="$TEMP_ARTIFACT_DIR" \
  docker compose --project-name hackos-event-day-qualification \
  --file "$COMPOSE_FILE" config --format json | \
  node "$ROOT_DIR/deploy/qualification/validate-compose.mjs" "$RELEASE_IMAGE"

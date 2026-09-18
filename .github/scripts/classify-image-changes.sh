#!/usr/bin/env bash
# Classify the files changed by a release commit (issue #760).
set -Eeuo pipefail

before_sha="${1:-}"
after_sha="${2:-HEAD}"
zero_sha=0000000000000000000000000000000000000000

if [[ -z "$before_sha" || "$before_sha" == "$zero_sha" ]]; then
  changed_files="$(git diff-tree --root --no-commit-id --name-only -r "$after_sha")"
else
  changed_files="$(git diff --name-only "$before_sha" "$after_sha")"
fi

api_image=false
web_image=false

while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  case "$path" in
    apps/api|apps/api/*)
      api_image=true
      ;;
    apps/web|apps/web/*)
      web_image=true
      ;;
    packages/shared|packages/shared/*|pnpm-lock.yaml|pnpm-workspace.yaml|package.json|.dockerignore|patches|patches/*)
      api_image=true
      web_image=true
      ;;
  esac
done <<< "$changed_files"

any_image=false
if [[ "$api_image" == true || "$web_image" == true ]]; then
  any_image=true
fi

printf 'api_image=%s\n' "$api_image"
printf 'web_image=%s\n' "$web_image"
printf 'any_image=%s\n' "$any_image"

#!/usr/bin/env bash
# Open an explicit main -> staging release PR.
# N/A — deployment workflow hardening.
#
# This deliberately never pushes a protected branch or rewrites a branch ref.
# Staging-only commits remain visible in the PR and must be resolved there.
set -euo pipefail

command -v gh >/dev/null || { echo "gh is required" >&2; exit 1; }

repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
comparison="$(gh api "repos/${repo}/compare/staging...main" --jq '.status')"
existing_pr="$(gh pr list \
  --repo "$repo" \
  --base staging \
  --head main \
  --state open \
  --json number,url \
  --jq 'if length > 0 then .[0] | "#\(.number) \(.url)" else empty end')"

if [[ -n "$existing_pr" ]]; then
  echo "An open main -> staging synchronization PR already exists: $existing_pr"
  exit 0
fi

case "$comparison" in
  identical)
    echo "staging already contains the current main tree."
    exit 0
    ;;
  behind)
    echo "staging is ahead of main; its staging-only work is being preserved."
    echo "No synchronization PR is needed until main has new commits."
    exit 0
    ;;
  ahead|diverged)
    gh pr create \
      --repo "$repo" \
      --base staging \
      --head main \
      --draft \
      --title "chore(release): sync main into staging" \
      --body $'Synchronize the current production tree into staging for explicit verification.\n\nThis is an intentional main → staging promotion. It does not overwrite staging-only work; resolve any conflicts in this pull request. Merge it only when the staging environment is ready for the production tree.'
    ;;
  *)
    echo "Unexpected comparison status from GitHub: $comparison" >&2
    exit 1
    ;;
esac

#!/usr/bin/env bash
# Make integration and staging point at the current main commit.
#
# The release-branches ruleset permits this explicit administrator operation.
# No force push is used: both lower branches must already be ancestors of main.
set -euo pipefail

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }

remote="${GIT_REMOTE:-origin}"
git fetch "$remote" main integration staging
main_sha="$(git rev-parse "${remote}/main")"

for branch in integration staging; do
  if ! git merge-base --is-ancestor "${remote}/${branch}" "$main_sha"; then
    echo "${branch} is not an ancestor of ${remote}/main; refusing to overwrite it." >&2
    exit 1
  fi
done

for branch in integration staging; do
  git push "$remote" "${main_sha}:refs/heads/${branch}"
done

echo "integration and staging now point at ${main_sha}."

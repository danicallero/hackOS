#!/usr/bin/env bash
# Configure the protected release branches used by the hackOS promotion flow.
#
# Requires an authenticated GitHub CLI with repository-administration access.
# The command is intentionally idempotent: it keeps the existing rules while
# separating the default branch rules from the lower release-branch rules.
set -euo pipefail

command -v gh >/dev/null || { echo "gh is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
main_ruleset_id="$(gh api "repos/${repo}/rulesets?per_page=100" \
  --jq '.[] | select(.name == "main") | .id' | head -n1)"

if [[ -z "$main_ruleset_id" ]]; then
  echo "Could not find the repository ruleset named main in ${repo}." >&2
  exit 1
fi

actor_id="$(gh api user --jq .id)"
main_ruleset="$(gh api "repos/${repo}/rulesets/${main_ruleset_id}")"

# Keep main protected by PRs and required CI, but do not make it the ruleset
# that also blocks the explicit main -> integration/staging synchronization.
printf '%s' "$main_ruleset" \
  | jq '{name, target, enforcement, bypass_actors: [],
      conditions: {ref_name: {include: ["~DEFAULT_BRANCH"], exclude: []}}, rules}' \
  | gh api --method PUT "repos/${repo}/rulesets/${main_ruleset_id}" --input - >/dev/null

release_ruleset_id="$(gh api "repos/${repo}/rulesets?per_page=100" \
  --jq '.[] | select(.name == "release-branches") | .id' | head -n1)"

if [[ -n "$release_ruleset_id" ]]; then
  release_ruleset="$(gh api "repos/${repo}/rulesets/${release_ruleset_id}")"
  method=PUT
  endpoint="repos/${repo}/rulesets/${release_ruleset_id}"
else
  release_ruleset="$main_ruleset"
  method=POST
  endpoint="repos/${repo}/rulesets"
fi

printf '%s' "$release_ruleset" \
  | jq --argjson actor_id "$actor_id" '{
      name: "release-branches",
      target,
      enforcement: "active",
      bypass_actors: [{actor_id: $actor_id, actor_type: "User", bypass_mode: "always"}],
      conditions: {ref_name: {include: ["refs/heads/integration", "refs/heads/staging"], exclude: []}},
      rules
    }' \
  | gh api --method "$method" "$endpoint" --input - >/dev/null

echo "Configured main, integration, and staging rulesets for ${repo}."
echo "The authenticated user may explicitly synchronize main into integration/staging."

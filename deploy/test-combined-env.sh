#!/usr/bin/env bash
# Regression test: the canonical single env file must satisfy the validator.
set -Eeuo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT

config_file="$test_dir/hackos.env"
cp "$deploy_dir/.env.example" "$config_file"
perl -0pi -e 's/sha-0{40}/sha-1111111111111111111111111111111111111111/g; s/CHANGE_ME/test-secret-value/g' "$config_file"
chmod 600 "$config_file"

bash "$deploy_dir/scripts/check-env.sh" "$config_file" >/dev/null
echo 'combined env contract: passed'

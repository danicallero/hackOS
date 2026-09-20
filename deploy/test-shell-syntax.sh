#!/usr/bin/env bash
# Keep every tracked deployment shell entry point parseable by its interpreter.
set -Eeuo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checked=0

while IFS= read -r file; do
  case "$(head -n 1 "$file")" in
    '#!/usr/bin/env bash') bash -n "$file" ;;
    '#!/usr/bin/env sh') sh -n "$file" ;;
    *)
      echo "unsupported shell interpreter: $file" >&2
      exit 1
      ;;
  esac
  checked=$((checked + 1))
done < <(find "$deploy_dir" -type f -name '*.sh' -print | sort)

(( checked > 0 )) || {
  echo 'no deployment shell scripts found' >&2
  exit 1
}

printf 'deployment shell syntax: %d script(s) passed\n' "$checked"

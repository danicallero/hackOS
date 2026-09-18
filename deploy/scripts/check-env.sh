#!/usr/bin/env bash
# Validate the flat env files used by the multi-architecture Compose runtime.
#
# Usage:
#   ./deploy/scripts/check-env.sh [config-file] [secrets-file] [image-tag]
#     [api-image-tag] [web-image-tag]
#
# A single chmod-600 combined file is accepted for compatibility with the
# current production host. The canonical contract remains two files.

set -euo pipefail

CONFIG_FILE="${1:-/etc/hackos/hackos.env}"
if [[ $# -ge 2 && -n "${2:-}" ]]; then
  SECRETS_FILE="$2"
elif [[ -r /etc/hackos/hackos.secrets ]]; then
  SECRETS_FILE=/etc/hackos/hackos.secrets
else
  SECRETS_FILE="$CONFIG_FILE"
fi
IMAGE_TAG_OVERRIDE="${3:-}"
API_IMAGE_TAG_OVERRIDE="${4:-}"
WEB_IMAGE_TAG_OVERRIDE="${5:-}"

die() {
  printf 'check-env: %s\n' "$1" >&2
  exit 1
}

[[ -r "$CONFIG_FILE" ]] || die "configuration file is not readable: $CONFIG_FILE"
[[ -r "$SECRETS_FILE" ]] || die "secrets file is not readable: $SECRETS_FILE"

if [[ "$CONFIG_FILE" == "$SECRETS_FILE" ]]; then
  secret_mode="$(stat -c '%a' "$SECRETS_FILE" 2>/dev/null || stat -f '%Lp' "$SECRETS_FILE")"
  [[ "$secret_mode" == 600 ]] || die "combined environment file must have mode 600: $SECRETS_FILE"
else
  secret_mode="$(stat -c '%a' "$SECRETS_FILE" 2>/dev/null || stat -f '%Lp' "$SECRETS_FILE")"
  [[ "$secret_mode" == 600 ]] || die "secrets file must have mode 600: $SECRETS_FILE"
fi

has_key() {
  local key="$1"
  local file="$2"
  awk -v key="$key" '
    /^[[:space:]]*(#|$)/ { next }
    {
      line = $0
      sub(/^[[:space:]]*/, "", line)
      split(line, fields, "=")
      if (fields[1] == key) found = 1
    }
    END { exit found ? 0 : 1 }
  ' "$file"
}

value_in_file() {
  local key="$1"
  local file="$2"
  awk -v key="$key" '
    /^[[:space:]]*(#|$)/ { next }
    {
      line = $0
      sub(/^[[:space:]]*/, "", line)
      split(line, fields, "=")
      if (fields[1] == key) {
        sub(/^[^=]*=/, "", line)
        value = line
      }
    }
    END {
      if (value != "") print value
    }
  ' "$file"
}

# Match Docker Compose's two-file precedence: the secrets file is loaded last.
value() {
  local key="$1"
  local result=""
  if [[ "$key" == IMAGE_TAG && -n "$IMAGE_TAG_OVERRIDE" ]]; then
    printf '%s' "$IMAGE_TAG_OVERRIDE"
    return 0
  fi
  if [[ "$key" == API_IMAGE_TAG && -n "$API_IMAGE_TAG_OVERRIDE" ]]; then
    printf '%s' "$API_IMAGE_TAG_OVERRIDE"
    return 0
  fi
  if [[ "$key" == WEB_IMAGE_TAG && -n "$WEB_IMAGE_TAG_OVERRIDE" ]]; then
    printf '%s' "$WEB_IMAGE_TAG_OVERRIDE"
    return 0
  fi
  if has_key "$key" "$SECRETS_FILE"; then
    result="$(value_in_file "$key" "$SECRETS_FILE")"
  elif has_key "$key" "$CONFIG_FILE"; then
    result="$(value_in_file "$key" "$CONFIG_FILE")"
  fi
  result="${result#\"}"
  result="${result%\"}"
  printf '%s' "$result"
}

require_value() {
  local key="$1"
  local result
  result="$(value "$key")"
  [[ -n "$result" ]] || die "$key is missing or empty"
  [[ "$result" != *CHANGE_ME* ]] || die "$key still contains CHANGE_ME"
  [[ "$result" != *REPLACE_WITH* ]] || die "$key still contains REPLACE_WITH"
  printf '%s' "$result"
}

api_domain="$(require_value API_DOMAIN)"
web_domain="$(require_value WEB_DOMAIN)"
image_tag="$(require_value IMAGE_TAG)"
api_image_tag="$(value API_IMAGE_TAG)"
api_image_tag="${api_image_tag:-$image_tag}"
web_image_tag="$(value WEB_IMAGE_TAG)"
web_image_tag="${web_image_tag:-$image_tag}"
cors_origins="$(require_value CORS_ORIGINS)"
hackos_data_dir="$(value HACKOS_DATA_DIR)"
hackos_data_dir="${hackos_data_dir:-/mnt/data}"
mail_provider="$(value MAIL_PROVIDER)"
mail_provider="${mail_provider:-smtp}"
mail_from="$(require_value MAIL_FROM_ADDRESS)"

[[ "$api_domain" =~ ^[A-Za-z0-9.-]+$ ]] || die 'API_DOMAIN must be a hostname, without a scheme or path'
[[ "$web_domain" =~ ^[A-Za-z0-9.-]+$ ]] || die 'WEB_DOMAIN must be a hostname, without a scheme or path'
[[ "$image_tag" =~ ^sha-[0-9a-f]{40}$ ]] || die 'IMAGE_TAG must match sha-<40 lowercase hexadecimal characters>'
[[ "$image_tag" != sha-0000000000000000000000000000000000000000 ]] || die 'IMAGE_TAG must identify a real commit'
[[ "$api_image_tag" =~ ^sha-[0-9a-f]{40}$ ]] || die 'API_IMAGE_TAG must match sha-<40 lowercase hexadecimal characters>'
[[ "$api_image_tag" != sha-0000000000000000000000000000000000000000 ]] || die 'API_IMAGE_TAG must identify a real commit'
[[ "$web_image_tag" =~ ^sha-[0-9a-f]{40}$ ]] || die 'WEB_IMAGE_TAG must match sha-<40 lowercase hexadecimal characters>'
[[ "$web_image_tag" != sha-0000000000000000000000000000000000000000 ]] || die 'WEB_IMAGE_TAG must identify a real commit'
[[ "$hackos_data_dir" == /* && "$hackos_data_dir" != "/" ]] || die 'HACKOS_DATA_DIR must be an absolute path other than /'
[[ "$hackos_data_dir" != *$'\n'* && "$hackos_data_dir" != *$'\r'* ]] || die 'HACKOS_DATA_DIR contains a newline'
case ",${cors_origins}," in
  *,"https://${web_domain}",*) ;;
  *) die "CORS_ORIGINS must include https://${web_domain}" ;;
esac
[[ "$mail_from" == *@*.* ]] || die 'MAIL_FROM_ADDRESS must be an email address'

[[ "$mail_provider" == smtp ]] || die 'MAIL_PROVIDER must be smtp'
require_value SMTP_HOST >/dev/null

for key in \
  POSTGRES_USER \
  POSTGRES_PASSWORD \
  POSTGRES_DB \
  VALKEY_PASSWORD \
  MINIO_ROOT_USER \
  MINIO_ROOT_PASSWORD \
  BETTER_AUTH_SECRET \
  S3_ACCESS_KEY \
  S3_SECRET_KEY; do
  require_value "$key" >/dev/null
done

s3_public_url="$(value S3_PUBLIC_URL)"
if [[ -n "$s3_public_url" && "$s3_public_url" != https://* ]]; then
  die 'S3_PUBLIC_URL must be an https URL when configured'
fi

r2_backups_enabled="$(value R2_BACKUPS_ENABLED)"
r2_backups_enabled="${r2_backups_enabled:-false}"
case "$r2_backups_enabled" in
  false) ;;
  true)
    r2_endpoint="$(require_value R2_ENDPOINT)"
    r2_bucket="$(require_value R2_BUCKET)"
    r2_prefix="$(require_value R2_PREFIX)"
    require_value R2_ACCESS_KEY_ID >/dev/null
    require_value R2_SECRET_ACCESS_KEY >/dev/null
    [[ "$r2_endpoint" =~ ^https://[A-Za-z0-9.-]+$ ]] || die 'R2_ENDPOINT must be an https host URL'
    [[ "$r2_bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || die 'R2_BUCKET is not a valid bucket name'
    [[ "$r2_prefix" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || die 'R2_PREFIX contains unsafe characters'
    [[ "$r2_prefix" != */ && "$r2_prefix" != *..* ]] || die 'R2_PREFIX must not end in / or contain ..'
    ;;
  *) die 'R2_BACKUPS_ENABLED must be true or false' ;;
esac

apple_keys=(
  APPLE_PASS_CERTIFICATE_PEM
  APPLE_PASS_KEY_PEM
  APPLE_WWDR_CERTIFICATE_PEM
)
apple_set=0
apple_missing=0
for key in "${apple_keys[@]}"; do
  if [[ -n "$(value "$key")" ]]; then
    apple_set=$((apple_set + 1))
  else
    apple_missing=$((apple_missing + 1))
  fi
done
(( apple_set == 0 || apple_missing == 0 )) || die 'Apple Wallet signing values must be complete or entirely unset'

google_keys=(
  GOOGLE_WALLET_ISSUER_ID
  GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL
  GOOGLE_WALLET_PRIVATE_KEY_PEM
)
google_set=0
google_missing=0
for key in "${google_keys[@]}"; do
  if [[ -n "$(value "$key")" ]]; then
    google_set=$((google_set + 1))
  else
    google_missing=$((google_missing + 1))
  fi
done
(( google_set == 0 || google_missing == 0 )) || die 'Google Wallet signing values must be complete or entirely unset'

printf 'check-env: configuration and secrets are valid for %s (%s)\n' "$api_domain" "$image_tag"

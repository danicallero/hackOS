#!/usr/bin/env bash
# Validate the two flat env files used by the multi-architecture Compose runtime.
#
# Usage:
#   ./deploy/scripts/check-env.sh [config-file] [secrets-file] [image-tag]

set -euo pipefail

CONFIG_FILE="${1:-/etc/hackos/hackos.env}"
SECRETS_FILE="${2:-/etc/hackos/hackos.secrets}"
IMAGE_TAG_OVERRIDE="${3:-}"

die() {
  printf 'check-env: %s\n' "$1" >&2
  exit 1
}

[[ -r "$CONFIG_FILE" ]] || die "configuration file is not readable: $CONFIG_FILE"
[[ -r "$SECRETS_FILE" ]] || die "secrets file is not readable: $SECRETS_FILE"

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
cors_origins="$(require_value CORS_ORIGINS)"
mail_provider="$(value MAIL_PROVIDER)"
mail_provider="${mail_provider:-smtp}"
mail_from="$(require_value MAIL_FROM_ADDRESS)"

[[ "$api_domain" =~ ^[A-Za-z0-9.-]+$ ]] || die 'API_DOMAIN must be a hostname, without a scheme or path'
[[ "$web_domain" =~ ^[A-Za-z0-9.-]+$ ]] || die 'WEB_DOMAIN must be a hostname, without a scheme or path'
[[ "$image_tag" =~ ^sha-[0-9a-f]{40}$ ]] || die 'IMAGE_TAG must match sha-<40 lowercase hexadecimal characters>'
[[ "$image_tag" != sha-0000000000000000000000000000000000000000 ]] || die 'IMAGE_TAG must identify a real commit'
case ",${cors_origins}," in
  *,"https://${web_domain}",*) ;;
  *) die "CORS_ORIGINS must include https://${web_domain}" ;;
esac
[[ "$mail_from" == *@*.* ]] || die 'MAIL_FROM_ADDRESS must be an email address'

case "$mail_provider" in
  smtp)
    require_value SMTP_HOST >/dev/null
    ;;
  resend)
    require_value RESEND_API_KEY >/dev/null
    ;;
  postal)
    require_value POSTAL_URL >/dev/null
    require_value POSTAL_API_KEY >/dev/null
    ;;
  *)
    die 'MAIL_PROVIDER must be smtp, resend, or postal'
    ;;
esac

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

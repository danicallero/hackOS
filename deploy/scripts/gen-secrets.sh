#!/usr/bin/env sh
# Generate a per-instance secret env file for a hackOS deployment.
#
#   ./deploy/scripts/gen-secrets.sh <api-domain> [web-domain] > .env.hackos
#
# Produces a filled .env file with fresh random secrets. Review the
# non-secret fields (CORS_ORIGINS, MAIL_FROM_ADDRESS, provider block) before
# deploying. Requires openssl.
set -eu

API_DOMAIN="${1:-api.example.org}"
# Web frontend domain: defaults to the API domain with the leading "api."
# stripped (api.event.org -> event.org). Override as the 2nd arg.
WEB_DOMAIN="${2:-${API_DOMAIN#api.}}"

rand() { openssl rand -base64 "${1:-24}" | tr -d '\n/+=' | cut -c1-32; }

cat <<EOF
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) — secrets are unique to this instance.
API_DOMAIN=${API_DOMAIN}
WEB_DOMAIN=${WEB_DOMAIN}
# Includes the web origin so Better Auth's trustedOrigins accepts sign-in.
CORS_ORIGINS=https://${WEB_DOMAIN}

BETTER_AUTH_SECRET=$(openssl rand -base64 32 | tr -d '\n')

POSTGRES_USER=hackos
POSTGRES_PASSWORD=$(rand 24)
POSTGRES_DB=hackos

VALKEY_PASSWORD=$(rand 24)

MINIO_ROOT_USER=hackos
MINIO_ROOT_PASSWORD=$(rand 24)
S3_ACCESS_KEY=hackos
S3_SECRET_KEY=$(rand 24)
S3_BUCKET=hackos

MAIL_FROM_ADDRESS=noreply@${API_DOMAIN#api.}
RESEND_API_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
POSTAL_URL=
POSTAL_API_KEY=
EOF

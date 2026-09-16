#!/usr/bin/env sh
# Generate the secret env file for the multi-architecture Compose runtime.
#
#   ./deploy/scripts/gen-secrets.sh > /etc/hackos/hackos.secrets
#
# The output is intentionally limited to secrets. Configure domains, image tag,
# mail provider and other non-secret values in /etc/hackos/hackos.env.

set -eu

rand() {
  openssl rand -base64 "${1:-24}" | tr -d '\n/+=' | cut -c1-32
}

cat <<EOF
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) — unique to this instance.
BETTER_AUTH_SECRET=$(openssl rand -base64 32 | tr -d '\n')

POSTGRES_USER=hackos
POSTGRES_PASSWORD=$(rand 24)
POSTGRES_DB=hackos

VALKEY_PASSWORD=$(rand 24)

MINIO_ROOT_USER=hackos
MINIO_ROOT_PASSWORD=$(rand 24)
S3_ACCESS_KEY=hackos-app
S3_SECRET_KEY=$(rand 24)

# Fill only the block selected by MAIL_PROVIDER in hackos.env.
RESEND_API_KEY=
POSTAL_URL=
POSTAL_API_KEY=
SMTP_USER=
SMTP_PASS=

# Optional Wallet signing values. Leave each platform entirely unset or fill
# its complete block; check-env.sh enforces that boundary.
APPLE_PASS_CERTIFICATE_PEM=
APPLE_PASS_KEY_PEM=
APPLE_PASS_KEY_PASSPHRASE=
APPLE_WWDR_CERTIFICATE_PEM=
GOOGLE_WALLET_PRIVATE_KEY_PEM=
EOF

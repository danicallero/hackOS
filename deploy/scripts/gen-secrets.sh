#!/usr/bin/env sh
# Generate the secret portion for a multi-architecture Compose runtime.
#
# The canonical host contract is one file. Start from deploy/.env.example,
# replace its CHANGE_ME values, and keep the resulting /etc/hackos/hackos.env
# at mode 600. This helper remains for operators migrating a legacy split-file
# host and therefore still emits only secret keys.
#
# The output is intentionally limited to secrets. It must not be committed or
# printed into logs.

set -eu

rand() {
  openssl rand -base64 "${1:-24}" | tr -d '\n/+=' | cut -c1-32
}

cat <<EOF
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) — unique to this instance.
BETTER_AUTH_SECRET=$(openssl rand -base64 32 | tr -d '\n')

POSTGRES_PASSWORD=$(rand 24)

VALKEY_PASSWORD=$(rand 24)

MINIO_ROOT_PASSWORD=$(rand 24)
S3_SECRET_KEY=$(rand 24)

# SMTP credentials for the relay selected in hackos.env. Amazon SES SMTP
# credentials are different from ordinary AWS access keys.
SMTP_USER=
SMTP_PASS=

# Cloudflare R2 S3 credentials for the optional backup helper. Keep R2_BACKUPS_ENABLED
# and the endpoint/bucket/prefix in hackos.env; create a scoped R2 token manually.
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=

# Optional Wallet signing values. Leave each platform entirely unset or fill
# its complete block; check-env.sh enforces that boundary.
APPLE_PASS_CERTIFICATE_PEM=
APPLE_PASS_KEY_PEM=
APPLE_PASS_KEY_PASSPHRASE=
APPLE_WWDR_CERTIFICATE_PEM=
GOOGLE_WALLET_PRIVATE_KEY_PEM=
EOF

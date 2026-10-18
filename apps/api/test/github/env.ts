process.env.VALKEY_URL = process.env.TEST_VALKEY_URL ?? "redis://localhost:6379/3";
process.env.GITHUB_APP_ID = "1";
process.env.GITHUB_APP_SLUG = "hackos-test";
process.env.GITHUB_APP_CLIENT_ID = "client";
process.env.GITHUB_APP_CLIENT_SECRET = "secret";
process.env.GITHUB_APP_PRIVATE_KEY_PEM = "unused-in-tests";
process.env.GITHUB_WEBHOOK_SECRET = "whsec";

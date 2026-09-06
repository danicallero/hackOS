# Mobile builds and release

Runbook for `apps/mobile`, split by who needs it and when. App feature
documentation is in [`mobile.md`](./mobile.md).

- [Local development and builds](./mobile-dev-setup.md) — accounts and
  tools, installing and running the stack, Expo project setup, EAS
  environments, build profiles, prebuild, compiling and running locally, and
  EAS preview/production builds. Read this day-to-day.
- [Signing, push, and Wallet credentials](./mobile-credentials.md) —
  certificates and keys, obtained once per environment, not per build.
- [Store release](./mobile-store-release.md) — icons and store artwork,
  privacy/permission declarations, store records, submission, and the
  release checklist. Read this only when shipping a build.

The examples across all three match the versions currently in the
repository: Expo SDK 57, React Native 0.86, and pnpm 10. Check Expo, Apple,
and Google requirements again when upgrading the SDK.

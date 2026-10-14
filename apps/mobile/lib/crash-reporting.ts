import type { ErrorEvent } from "@sentry/react-native";
import * as Sentry from "@sentry/react-native";
import { API_URL, onApiUrlChange, PRODUCTION_API_URL } from "./env";

/**
 * Crash and error reports (Sentry SDK; any Sentry-compatible server). Off
 * unless the build embeds `EXPO_PUBLIC_SENTRY_DSN`, and always off in
 * development. Reports carry no personal data: no user, no IP, no request
 * headers or bodies (the session cookie travels in headers), no query strings.
 */
export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() || undefined;

function withoutQuery(url: string): string {
  return url.split(/[?#]/, 1)[0];
}

/** Strips anything that could identify a person before an event leaves the device. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.url) event.request.url = withoutQuery(event.request.url);
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.data?.url === "string") crumb.data.url = withoutQuery(crumb.data.url);
  }
  return event;
}

/** `production` or `development` API: the developer switch can point a store build at staging. */
function tagApi(): void {
  Sentry.getGlobalScope().setTag(
    "api",
    API_URL === PRODUCTION_API_URL ? "production" : "development",
  );
}

export function initCrashReporting(dsn = SENTRY_DSN): boolean {
  if (!dsn || __DEV__) return false;
  // Release and dist come from the native app (version and build number),
  // matching the source maps the build uploads.
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    // Errors only: no performance tracing, profiling or session replay.
    tracesSampleRate: 0,
    // Console output can include names and emails from API payloads.
    beforeBreadcrumb: (crumb) => (crumb.category === "console" ? null : crumb),
    beforeSend: scrubEvent,
  });
  tagApi();
  onApiUrlChange(tagApi);
  return true;
}

export function captureError(error: unknown): void {
  if (SENTRY_DSN && !__DEV__) Sentry.captureException(error);
}

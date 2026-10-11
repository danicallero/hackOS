import { createPrivateKey, type KeyObject, sign } from "node:crypto";
import { type ClientHttp2Session, connect } from "node:http2";
import {
  LIVE_ACTIVITY_WIDGET_NAMES,
  type LiveActivityKind,
  type LiveActivityProps,
} from "@hackos/shared/live-activities";
import { config } from "../../config.js";

/**
 * APNs Live Activity sender (#966; H38, H25, H26). Token-based auth (an ES256
 * JWT signed with the team's `.p8` key) over HTTP/2, as ActivityKit remote
 * start/update/end pushes require — unlike Wallet's certificate auth in
 * logistics/apple-push.ts, whose request handling (request-level error
 * listener, timeout) this mirrors.
 */

const APNS_HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
} as const;

/**
 * Name of the `ActivityAttributes` struct expo-widgets compiles into the
 * widget extension (packages/expo-widgets/ios/Widgets/WidgetLiveActivity.swift).
 * A push-to-start with any other `attributes-type` is silently dropped.
 */
export const EXPO_WIDGETS_ATTRIBUTES_TYPE = "LiveActivityAttributes";

/** HIG: keep an ended activity on the Lock Screen briefly, not for the 4 h default. */
export const END_DISMISSAL_SECONDS = 15 * 60;

/** Apple accepts a provider token for up to an hour; refresh well before that. */
const JWT_TTL_MS = 50 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

export type LiveActivityEvent = "start" | "update" | "end";

export interface ApnsAlert {
  title: string;
  body: string;
}

export interface LiveActivityPushInput {
  event: LiveActivityEvent;
  kind: LiveActivityKind;
  props: LiveActivityProps;
  now: Date;
  /** Required on start (or the start is dropped); on update only for essential changes. */
  alert?: ApnsAlert;
  /** Static attributes, start only. expo-widgets keeps the tap URL here. */
  attributes?: { url: string };
  staleDate?: Date;
  relevanceScore?: number;
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/**
 * The `aps` payload. `content-state` must match expo-widgets'
 * `LiveActivityAttributes.ContentState { name, props: String? }` exactly:
 * `name` selects the registered layout and `props` is the JSON string the
 * layout receives.
 */
export function liveActivityApnsPayload(input: LiveActivityPushInput): Record<string, unknown> {
  const aps: Record<string, unknown> = {
    timestamp: seconds(input.now),
    event: input.event,
    "content-state": {
      name: LIVE_ACTIVITY_WIDGET_NAMES[input.kind],
      props: JSON.stringify(input.props),
    },
  };
  if (input.event === "start") {
    aps["attributes-type"] = EXPO_WIDGETS_ATTRIBUTES_TYPE;
    aps.attributes = input.attributes ?? { url: input.props.url };
  }
  if (input.alert) aps.alert = input.alert;
  if (input.staleDate) aps["stale-date"] = seconds(input.staleDate);
  if (input.relevanceScore !== undefined) aps["relevance-score"] = input.relevanceScore;
  if (input.event === "end") {
    aps["dismissal-date"] = seconds(input.now) + END_DISMISSAL_SECONDS;
  }
  return { aps };
}

export interface ApnsRequest {
  token: string;
  /** 10 = immediate (start, call, end); 5 = budget-friendly routine update. */
  priority: 5 | 10;
  payload: Record<string, unknown>;
}

export interface ApnsResponse {
  status: number;
  reason?: string;
}

/** Injectable so tests never reach Apple. */
export interface ApnsTransport {
  send(request: ApnsRequest): Promise<ApnsResponse>;
  close(): void;
}

/** APNs says the token will never work again: forget it. */
export function isDeadApnsToken(response: ApnsResponse): boolean {
  return (
    response.status === 410 ||
    response.reason === "BadDeviceToken" ||
    response.reason === "ExpiredToken" ||
    response.reason === "Unregistered"
  );
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** ES256 provider token (header `kid`, claims `iss` + `iat`), JOSE-encoded signature. */
export function signApnsJwt(params: {
  keyId: string;
  teamId: string;
  key: KeyObject | string;
  issuedAt: Date;
}): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: params.keyId }));
  const claims = base64url(JSON.stringify({ iss: params.teamId, iat: seconds(params.issuedAt) }));
  const signingInput = `${header}.${claims}`;
  const key = typeof params.key === "string" ? createPrivateKey(params.key) : params.key;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64url(signature)}`;
}

let cachedJwt: { token: string; issuedAt: number } | undefined;
let cachedKey: KeyObject | undefined;

function providerToken(now = Date.now()): string {
  if (cachedJwt && now - cachedJwt.issuedAt < JWT_TTL_MS) return cachedJwt.token;
  cachedKey ??= createPrivateKey(Buffer.from(config.APNS_AUTH_KEY_P8!, "base64").toString("utf8"));
  const token = signApnsJwt({
    keyId: config.APNS_KEY_ID!,
    teamId: config.APPLE_TEAM_IDENTIFIER!,
    key: cachedKey,
    issuedAt: new Date(now),
  });
  cachedJwt = { token, issuedAt: now };
  return token;
}

/** Drop the cached provider token, e.g. after APNs rejects it as expired. */
function resetProviderToken(): void {
  cachedJwt = undefined;
}

/**
 * One HTTP/2 session per worker tick, reused for every push in it. Returns
 * null when APNs isn't configured (the worker then skips iOS delivery).
 */
export function createApnsTransport(): ApnsTransport | null {
  if (!config.liveActivityApnsConfigured) return null;
  const host = APNS_HOSTS[config.APPLE_APNS_ENVIRONMENT];
  const topic = `${config.APNS_BUNDLE_ID}.push-type.liveactivity`;
  let session: ClientHttp2Session | undefined;

  const getSession = () => {
    if (session && !session.closed && !session.destroyed) return session;
    const next = connect(host);
    // A session-level failure must not become an uncaught 'error' event;
    // each pending request also rejects through its own stream listener.
    next.on("error", () => {
      if (session === next) session = undefined;
    });
    next.on("close", () => {
      if (session === next) session = undefined;
    });
    session = next;
    return next;
  };

  return {
    send(request) {
      return new Promise<ApnsResponse>((resolve, reject) => {
        let req: ReturnType<ClientHttp2Session["request"]>;
        try {
          req = getSession().request({
            ":method": "POST",
            ":path": `/3/device/${request.token}`,
            authorization: `bearer ${providerToken()}`,
            "apns-push-type": "liveactivity",
            "apns-topic": topic,
            "apns-priority": String(request.priority),
          });
        } catch (err) {
          reject(err);
          return;
        }
        // Network/DNS failures surface on the stream; without this listener
        // they would crash the worker process instead of failing the push.
        req.once("error", reject);
        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
          req.destroy(new Error("APNs request timed out"));
        });
        req.setEncoding("utf8");
        let status = 0;
        req.on("response", (headers) => {
          status = Number(headers[":status"]);
        });
        let body = "";
        req.on("data", (chunk: string) => {
          body += chunk;
        });
        req.on("end", () => {
          let reason: string | undefined;
          if (body) {
            try {
              reason = (JSON.parse(body) as { reason?: string }).reason;
            } catch {
              reason = undefined;
            }
          }
          if (reason === "ExpiredProviderToken") resetProviderToken();
          resolve({ status, reason });
        });
        req.end(JSON.stringify(request.payload));
      });
    },
    close() {
      session?.close();
      session = undefined;
    },
  };
}

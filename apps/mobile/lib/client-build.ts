import { nativeBuildVersion } from "expo-application";
import * as Device from "expo-device";

/** Native build number sent on every API request; the API enforces `MOBILE_MIN_BUILD` (#999). */
export const CLIENT_BUILD_HEADER = "X-HackOS-Build";

/** Empty when the build number is unknown (web preview, dev client without a native build). */
export function clientBuildHeaders(
  build: string | null = nativeBuildVersion,
): Record<string, string> {
  return build && /^\d+$/.test(build) ? { [CLIENT_BUILD_HEADER]: build } : {};
}

interface DeviceInfo {
  manufacturer?: string | null;
  modelName?: string | null;
  osName?: string | null;
  osVersion?: string | null;
}

// A header value: printable ASCII only, without the delimiters the web parser splits on.
const headerSafe = (value: string) => value.replace(/[^\x20-\x7e]|[;()]/g, "").trim();

/**
 * `hackOS/42 (iPhone 15 Pro; iOS 18.1)`: Better Auth stores the sign-in
 * request's user-agent on the session, and the web's Active devices list
 * (H4) names the phone from it. Empty when the model is unknown, which leaves
 * the platform's default user-agent in place.
 */
export function deviceUserAgentHeaders(
  device: DeviceInfo = Device,
  build: string | null = nativeBuildVersion,
): Record<string, string> {
  const model = headerSafe(device.modelName ?? "");
  if (!model) return {};
  // Android reports a bare model code ("SM-G991B"); the maker makes it recognisable.
  const maker = headerSafe(device.manufacturer ?? "");
  const named =
    maker && maker !== "Apple" && !model.toLowerCase().startsWith(maker.toLowerCase())
      ? `${maker} ${model}`
      : model;
  const system = headerSafe([device.osName, device.osVersion].filter(Boolean).join(" "));
  const product = build && /^\d+$/.test(build) ? `hackOS/${build}` : "hackOS";
  return { "User-Agent": `${product} (${[named, system].filter(Boolean).join("; ")})` };
}

/** Every header that identifies this install to the API. */
export function clientHeaders(): Record<string, string> {
  return { ...clientBuildHeaders(), ...deviceUserAgentHeaders() };
}

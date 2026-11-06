import { getStateFromPath } from "expo-router/build/fork/getStateFromPath";
import { getReactNavigationConfig } from "expo-router/build/getReactNavigationConfig";
import { getRoutes } from "expo-router/build/getRoutes";
import type { RequireContext } from "expo-router/build/types";

jest.mock("expo-router/stack", () => ({ Stack: () => null }));
jest.mock("@/components/glass-view", () => ({ isRealLiquidGlassAvailable: () => false }));

import { unstable_settings as activities } from "../app/(tabs)/activities/_layout";
import { unstable_settings as account } from "../app/(tabs)/others/_layout";
import { unstable_settings as projects } from "../app/(tabs)/queue/_layout";
import { unstable_settings as scan } from "../app/(tabs)/scan/_layout";
import { unstable_settings as schedule } from "../app/(tabs)/schedule/_layout";

const Screen = () => null;

describe("cold-link back destinations (H55)", () => {
  const cases = [
    { stack: "scan", settings: scan, owner: "index", child: "person/[id]", path: "person/2" },
    {
      stack: "activities",
      settings: activities,
      owner: "index",
      child: "people/index",
      path: "people",
    },
    { stack: "queue", settings: projects, owner: "index", child: "invites", path: "invites" },
    { stack: "schedule", settings: schedule, owner: "index", child: "alerts", path: "alerts" },
    {
      stack: "others",
      settings: account,
      owner: "account",
      child: "notification-settings/live-activities",
      path: "notification-settings/live-activities",
    },
  ];

  it.each(cases)("keeps $owner below a directly opened $stack child", ({
    stack,
    settings,
    owner,
    child,
    path,
  }) => {
    const modules: Record<string, unknown> = {
      "./_layout.tsx": { default: Screen },
      [`./${stack}/_layout.tsx`]: { default: Screen, unstable_settings: settings },
      [`./${stack}/${owner}.tsx`]: { default: Screen },
      [`./${stack}/${child}.tsx`]: { default: Screen },
    };
    const context = Object.assign((key: string) => modules[key], {
      keys: () => Object.keys(modules),
      resolve: (key: string) => key,
      id: "cold-link-back-destinations",
    }) as RequireContext;
    const config = getReactNavigationConfig(getRoutes(context), true);
    const state = getStateFromPath(`/${stack}/${path}`, config);
    const nested = state?.routes.find((route) => route.name === stack)?.state;
    expect(nested?.routes.map((route) => route.name)).toEqual([owner, child]);

    const ownerPath = owner === "index" ? `/${stack}` : `/${stack}/${owner}`;
    const ownerState = getStateFromPath(ownerPath, config);
    expect(
      ownerState?.routes
        .find((route) => route.name === stack)
        ?.state?.routes.map((route) => route.name),
    ).toEqual([owner]);
  });
});

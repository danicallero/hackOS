import type { OnboardingAction, ResolvedOnboardingStep } from "@hackos/shared/onboarding";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingState } from "@/lib/onboarding";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  decide: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  role: "Participant" as string | null,
  locks: { profileLocked: false, dietaryLocked: false },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    language: "es",
  }),
  pickText: () => "",
}));
vi.mock("@/lib/session", () => ({
  useSessionContext: () => ({
    me: { id: 7, visibleRoleName: mocks.role, hasEventAccess: true, ...mocks.locks },
    refresh: mocks.refresh,
  }),
}));
vi.mock("@/lib/onboarding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/onboarding")>()),
  readOnboarding: mocks.read,
  decideStep: mocks.decide,
}));
vi.mock("@/hooks/use-server-resource", () => ({
  useServerResource: (_key: unknown, fetcher: (s: AbortSignal) => Promise<OnboardingState>) => {
    const [data, setData] = useState<OnboardingState | null>(null);
    const [nonce, setNonce] = useState(0);
    // biome-ignore lint/correctness/useExhaustiveDependencies: nonce reloads.
    useEffect(() => {
      void fetcher(new AbortController().signal).then(setData);
    }, [nonce]);
    return {
      data,
      error: null,
      loading: !data,
      reload: () => setNonce((n) => n + 1),
      mutate: setData,
    };
  },
}));
// Step bodies are exercised in their own tests; here each exposes the decision callbacks.
vi.mock("@/components/onboarding/onboarding-steps", () => ({
  STEP_TITLES: new Proxy({}, { get: (_t, name) => `title:${String(name)}` }),
  STEP_DESCRIPTIONS: new Proxy({}, { get: (_t, name) => `desc:${String(name)}` }),
  WelcomeStep: ({ decide }: { decide: (a: OnboardingAction) => void }) => (
    <button type="button" onClick={() => decide("complete")}>
      welcome-start
    </button>
  ),
  ProfileStep: ({
    allowed,
    decide,
  }: {
    allowed: string[];
    decide: (a: OnboardingAction) => void;
  }) => (
    <div>
      {allowed.includes("skip") && (
        <button type="button" onClick={() => decide("skip")}>
          skip
        </button>
      )}
      {allowed.includes("defer") && (
        <button type="button" onClick={() => decide("defer")}>
          later
        </button>
      )}
    </div>
  ),
  NetworkingStep: ({ decide }: { decide: (a: OnboardingAction) => void }) => (
    <div>
      <button type="button" onClick={() => decide("complete")}>
        create
      </button>
      <button type="button" onClick={() => decide("decline")}>
        decline
      </button>
      <button type="button" onClick={() => decide("defer")}>
        later
      </button>
    </div>
  ),
  MentorStep: () => <p>mentor-body</p>,
  NotificationsStep: () => <p>notifications-body</p>,
  ShareStep: () => <p>share-body</p>,
  CompletionStep: () => <p>completion-body</p>,
}));
vi.mock("@/components/onboarding/rsvp-step", () => ({ RsvpStep: () => <p>rsvp-body</p> }));

import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const step = (
  name: ResolvedOnboardingStep["step"],
  status: ResolvedOnboardingStep["status"],
  actions: OnboardingAction[] = status === "pending"
    ? ["complete", "defer", "skip", "decline"]
    : [],
  required = false,
): ResolvedOnboardingStep => ({ step: name, status, required, deferredUntil: null, actions });

const journey = (
  overrides: Partial<Record<string, ResolvedOnboardingStep>> = {},
): OnboardingState => ({
  eventKey: "hackudc-2027",
  revision: 1,
  steps: (
    [
      step("welcome", "completed"),
      step("profile", "completed"),
      step("networking", "pending"),
      step("mentor_profile", "pending"),
      step("completion", "pending"),
    ] as ResolvedOnboardingStep[]
  ).map((s) => overrides[s.step] ?? s),
});

let container: HTMLDivElement;
let root: Root;

/** Renders the entry page (no `?step=`). */
async function mountIntro() {
  await act(async () => root.render(<OnboardingFlow />));
  await act(async () => undefined);
}
/** Renders and leaves the entry page through its Start button. */
async function mount() {
  await mountIntro();
  if (container.textContent?.includes("onboardingIntroTitle")) await click("onboardingStart");
}
const click = async (label: string) => {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button ${label}`);
  await act(async () => button.click());
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) if (typeof mock === "function") mock.mockReset();
  mocks.role = "Participant";
  mocks.locks = { profileLocked: false, dietaryLocked: false };
  window.history.replaceState(null, "", "/onboarding");
  mocks.read.mockResolvedValue(journey());
  mocks.decide.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("OnboardingFlow", () => {
  it("resumes at the first pending step and marks it as the current one", async () => {
    await mount();
    expect(container.querySelector("h1")?.textContent).toBe("title:networking");
    const current = container.querySelector('[aria-current="step"]');
    expect(current?.getAttribute("aria-label")).toBe("title:networking");
    // Only what was still open when the journey started is listed: not the finished
    // profile step, not the welcome or completion steps.
    expect(container.querySelectorAll("ol button").length).toBe(2);
    expect(container.textContent).toContain("create");
  });

  it("persists create, decline and later as three distinct answers", async () => {
    const outcomes: Record<string, [OnboardingAction, string | undefined]> = {};
    for (const label of ["create", "decline", "later"]) {
      mocks.decide.mockClear();
      mocks.read.mockResolvedValue(journey());
      act(() => root.unmount());
      root = createRoot(container);
      await mount();
      await click(label);
      const [stepName, action, until] = mocks.decide.mock.calls[0];
      expect(stepName).toBe("networking");
      outcomes[label] = [action, until];
    }
    expect(outcomes.create[0]).toBe("complete");
    expect(outcomes.decline[0]).toBe("decline");
    expect(outcomes.later[0]).toBe("defer");
    expect(new Date(outcomes.later[1] as string).getTime()).toBeGreaterThan(Date.now());
    expect(outcomes.create[1]).toBeUndefined();
  });

  it("moves on to the next pending step after a decision and re-reads the server state", async () => {
    mocks.read
      .mockResolvedValueOnce(journey())
      .mockResolvedValueOnce(journey({ networking: step("networking", "declined") }));
    await mount();
    await click("decline");
    expect(mocks.decide).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/onboarding?step=mentor_profile", {
      scroll: false,
    });
    expect(container.textContent).toContain("mentor-body");
  });

  it("offers Skip only when the server allows it; a required step can only be put off", async () => {
    mocks.read.mockResolvedValue(
      journey({
        profile: step("profile", "pending", ["complete", "defer"], true),
        networking: step("networking", "completed"),
      }),
    );
    await mount();
    expect(container.textContent).toContain("title:profile");
    expect(container.textContent).toContain("later");
    expect(container.textContent).not.toContain("skip");
  });

  it("does not depend on the person's role: only the server's steps are rendered", async () => {
    const seen: string[] = [];
    for (const role of ["Participant", "Sponsor", null]) {
      mocks.role = role;
      mocks.read.mockResolvedValue(journey({ mentor_profile: undefined }));
      act(() => root.unmount());
      root = createRoot(container);
      await mount();
      seen.push(
        [...container.querySelectorAll("nav li")]
          .map((li) => li.textContent?.split(" ")[0])
          .join(","),
      );
    }
    expect(new Set(seen).size).toBe(1);
  });

  it("leaves the shell reachable after the last step and on a failed save keeps the step", async () => {
    mocks.decide.mockRejectedValueOnce(new Error("offline"));
    await mount();
    await click("create");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.textContent).toContain("onboardingCouldNotSave");
    expect(container.querySelector("h1")?.textContent).toBe("title:networking");
  });

  it("marks completed steps with a done label", async () => {
    mocks.read
      .mockResolvedValueOnce(journey())
      .mockResolvedValueOnce(journey({ networking: step("networking", "completed") }));
    await mount();
    await click("create");
    const labels = [...container.querySelectorAll("ol button")].map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels[0]).toBe("title:networking · onboardingStatusDone");
    expect(labels[1]).toBe("title:mentor_profile");
  });

  it("opens on an intro that lists only the open steps and starts at the first", async () => {
    await mountIntro();
    expect(container.querySelector("h1")?.textContent).toBe("onboardingIntroTitle");
    const items = [...container.querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual([
      "1title:networkingdesc:networking",
      "2title:mentor_profiledesc:mentor_profile",
    ]);
    await click("onboardingStart");
    expect(mocks.replace).toHaveBeenCalledWith("/onboarding?step=networking", { scroll: false });
    expect(container.querySelector("h1")?.textContent).toBe("title:networking");
  });

  it("lets the person leave the intro for the app", async () => {
    await mountIntro();
    await click("onboardingLater");
    expect(mocks.push).toHaveBeenCalledWith("/event");
  });

  it("goes straight home when nothing is left to answer", async () => {
    mocks.read.mockResolvedValue(
      journey({
        networking: step("networking", "completed"),
        mentor_profile: step("mentor_profile", "completed"),
        completion: step("completion", "completed"),
      }),
    );
    await mountIntro();
    expect(mocks.replace).toHaveBeenCalledWith("/event");
  });

  it("hides the profile and dietary steps from someone who can no longer change them", async () => {
    mocks.locks = { profileLocked: true, dietaryLocked: true };
    mocks.read.mockResolvedValue(
      journey({ dietary: step("dietary", "pending"), profile: step("profile", "pending") }),
    );
    await mount();
    const labels = [...container.querySelectorAll("ol button")].map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels.join()).not.toContain("title:profile");
    expect(labels.join()).not.toContain("title:dietary");
  });

  it("shows the welcome step only when the organizer wrote a message", async () => {
    mocks.read.mockResolvedValue({
      ...journey({ welcome: step("welcome", "pending") }),
      welcomeMessage: { es: "Hola" },
    });
    await mount();
    expect(container.querySelector("h1")?.textContent).toBe("title:welcome");
  });

  it("renders the completion step when it is requested", async () => {
    window.history.replaceState(null, "", "/onboarding?step=completion");
    mocks.read.mockResolvedValue(journey({ networking: step("networking", "completed") }));
    await mount();
    expect(container.textContent).toContain("completion-body");
  });
});

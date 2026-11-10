import { ATTENDANCE_KINDS, ONBOARDING_STEPS } from "@hackos/shared/onboarding";
import { describe, expect, it } from "vitest";
import { toConfig, toForm } from "./onboarding-settings";

describe("onboarding settings form", () => {
  it("starts from the shared defaults for an empty config", () => {
    const form = toForm({});
    for (const step of ONBOARDING_STEPS) {
      expect(form.steps[step].enabled).toBe(true);
      expect(form.steps[step].kinds).toEqual([...ATTENDANCE_KINDS]);
    }
    expect(form.steps.profile.required).toBe(true);
    expect(form.steps.networking.required).toBe(false);
  });

  it("never stores a required step as disabled, nor networking as required", () => {
    const form = toForm({});
    form.steps.rsvp = { ...form.steps.rsvp, enabled: false, required: true };
    form.steps.networking = { ...form.steps.networking, required: true };
    const config = toConfig(form);
    expect(config.rsvp).toMatchObject({ enabled: false, required: false });
    expect(config.networking?.required).toBe(false);
  });

  it("keeps only non-empty welcome translations and the profile field list", () => {
    const form = toForm({});
    form.welcomeMessage = { es: " Hola ", gl: "", en: "  " };
    const config = toConfig(form, { profile: { fields: ["name"] } });
    expect(config.welcome?.message).toEqual({ es: "Hola" });
    expect(config.profile?.fields).toEqual(["name"]);
    expect(toForm(config).welcomeMessage).toEqual({ es: "Hola", gl: "", en: "" });
  });
});

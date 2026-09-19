import { beforeEach, describe, expect, it, vi } from "vitest";

const sileoMock = vi.hoisted(() => {
  let idSequence = 0;
  const nextId = (kind: string) => `${kind}-id-${++idSequence}`;
  return {
    success: vi.fn((_options: unknown) => nextId("success")),
    error: vi.fn((_options: unknown) => nextId("error")),
    warning: vi.fn((_options: unknown) => nextId("warning")),
    info: vi.fn((_options: unknown) => nextId("info")),
    show: vi.fn((_options: unknown) => nextId("loading")),
    action: vi.fn((_options: unknown) => nextId("action")),
    promise: vi.fn(
      async (promise: Promise<unknown> | (() => Promise<unknown>), _options?: unknown) =>
        typeof promise === "function" ? promise() : promise,
    ),
    dismiss: vi.fn(),
    clear: vi.fn(),
  };
});

vi.mock("sileo", () => ({ sileo: sileoMock }));

import { toast } from "./toast";

describe("toast adapter", () => {
  beforeEach(() => {
    toast.clear();
    vi.clearAllMocks();
  });

  it("gives each notification its own id so Sileo can stack them", () => {
    toast.success("Saved");
    toast.success("Published");

    const first = sileoMock.success.mock.calls[0]?.[0] as
      | { id?: string; title?: string }
      | undefined;
    const second = sileoMock.success.mock.calls[1]?.[0] as
      | { id?: string; title?: string }
      | undefined;
    expect(first).toMatchObject({ title: "Saved" });
    expect(second).toMatchObject({ title: "Published" });
    expect(first?.id).toBeDefined();
    expect(second?.id).toBeDefined();
    expect(first?.id).not.toBe(second?.id);
  });

  it("maps descriptions and actions to Sileo's expandable content", () => {
    const onUndo = vi.fn();

    toast.info("Team called", {
      description: "Head to room 3",
      duration: 10_000,
      action: { label: "Undo", onClick: onUndo },
    });

    expect(sileoMock.info).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Team called",
        description: "Head to room 3",
        duration: 10_000,
        button: { title: "Undo", onClick: onUndo },
        autopilot: false,
      }),
    );
  });

  it("keeps ordinary notifications compact and leaves expansion to real content", () => {
    toast.success("Guardado");

    const options = sileoMock.success.mock.calls[0]?.[0] as
      | {
          button?: { title?: string; onClick?: () => void };
          autopilot?: boolean;
        }
      | undefined;
    expect(options?.button).toBeUndefined();
    expect(options?.autopilot).toBeUndefined();
  });

  it("uses short defaults for routine feedback while preserving more time for errors", () => {
    toast.success("Saved");
    toast.info("Heads up");
    toast.error("Could not save");

    expect(sileoMock.success).toHaveBeenCalledWith(expect.objectContaining({ duration: 2_400 }));
    expect(sileoMock.info).toHaveBeenCalledWith(expect.objectContaining({ duration: 2_000 }));
    expect(sileoMock.error).toHaveBeenCalledWith(expect.objectContaining({ duration: 5_000 }));
  });

  it("spills an over-long error title into an auto-expanded description", () => {
    const longMessage = "D".repeat(120);
    toast.error(longMessage);

    expect(sileoMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "La acción ha fallado.",
        description: longMessage,
      }),
    );
    const options = sileoMock.error.mock.calls[0]?.[0] as
      | { autopilot?: boolean; button?: unknown }
      | undefined;
    expect(options?.autopilot).toBeUndefined();
    expect(options?.button).toBeUndefined();
  });

  it("spills over-long warning titles the same way", () => {
    toast.warning("W".repeat(100));

    expect(sileoMock.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "La acción ha fallado.",
        description: "W".repeat(100),
      }),
    );
  });

  it("leaves intentional short error titles as compact single-line toasts", () => {
    toast.error("Pide a un administrador acceso al horario para buscar usuarios.");

    const options = sileoMock.error.mock.calls[0]?.[0] as
      | { title?: string; description?: unknown }
      | undefined;
    expect(options?.title).toBe("Pide a un administrador acceso al horario para buscar usuarios.");
    expect(options?.description).toBeUndefined();
  });

  it("keeps the full review-fixtures server error readable", () => {
    const serverMessage =
      "Review fixtures are disabled until REVIEW_FIXTURE_PASSWORD and REVIEW_FIXTURE_DELETION_PIN are configured.";
    expect(serverMessage.length).toBeGreaterThan(80);
    toast.error(serverMessage);

    expect(sileoMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ title: "La acción ha fallado.", description: serverMessage }),
    );
  });

  it("coalesces identical plain feedback without restarting its timeline", () => {
    const first = toast.error("Couldn't call team", {
      description: "One member is active in another room.",
    });
    const second = toast.error("Couldn't call team", {
      description: "One member is active in another room.",
    });

    expect(second).toBe(first);
    expect(sileoMock.error).toHaveBeenCalledTimes(1);
  });

  it("keeps the top-right stack bounded while preserving persistent work", () => {
    const loading = toast.loading("Uploading");
    const first = toast.info("First update");
    toast.info("Second update");
    toast.info("Third update");
    toast.info("Fourth update");

    expect(sileoMock.dismiss).toHaveBeenCalledWith(first);
    expect(sileoMock.dismiss).not.toHaveBeenCalledWith(loading);
  });

  it("treats an untyped toast as an informational notification", () => {
    toast("Get ready");

    expect(sileoMock.info).toHaveBeenCalledWith(expect.objectContaining({ title: "Get ready" }));
  });

  it("supports sticky loading and explicit action states", () => {
    toast.loading("Uploading", { description: "profile.pdf" });
    toast.action("Invite sent", {
      action: { label: "Copy link", onClick: vi.fn() },
    });

    expect(sileoMock.show).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "loading",
        duration: null,
        title: "Uploading",
        description: "profile.pdf",
      }),
    );
    expect(sileoMock.action).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Invite sent",
        button: expect.objectContaining({ title: "Copy link" }),
        autopilot: false,
      }),
    );
  });

  it("supports a custom icon without losing the Sileo state treatment", () => {
    toast.icon("Copied", { icon: "✓" });

    expect(sileoMock.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Copied",
        icon: "✓",
      }),
    );
  });

  it("keeps the native promise lifecycle on one toast", async () => {
    const result = await toast.promise(Promise.resolve({ id: 1 }), {
      loading: { title: "Saving" },
      success: { title: "Saved", description: "The changes are live." },
      error: { title: "Could not save" },
    });

    expect(result).toEqual({ id: 1 });
    expect(sileoMock.promise).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        loading: expect.objectContaining({ title: "Saving", duration: null }),
        success: expect.any(Function),
        error: expect.any(Function),
      }),
    );

    const promiseOptions = sileoMock.promise.mock.calls[0]?.[1] as {
      success?: (value: { id: number }) => { autopilot?: boolean };
    };
    expect(promiseOptions.success?.({ id: 1 })).toMatchObject({ autopilot: false });
  });

  it("keeps rich promise outcomes compact until the user explores them", () => {
    toast.promise(Promise.resolve("done"), {
      loading: { title: "Working" },
      success: {
        title: "Done",
        description: "The result is ready.",
        action: { label: "Open", onClick: vi.fn() },
      },
      error: { title: "Failed" },
    });

    const promiseOptions = sileoMock.promise.mock.calls[0]?.[1] as {
      success?: (value: string) => { autopilot?: boolean };
    };
    expect(promiseOptions.success?.("done")).toMatchObject({ autopilot: false });
  });
});

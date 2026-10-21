import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Alert, Platform } from "react-native";
import { AlertHost } from "@/components/alert-host";
import { alert, currentAlert, dismissAlert } from "@/lib/alert";

describe("alert (H55, H59)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    while (currentAlert()) dismissAlert(currentAlert()?.id ?? 0);
  });

  it("uses the system alert on iOS", () => {
    const system = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    alert("Title", "Body");
    expect(system).toHaveBeenCalledWith("Title", "Body");
    expect(currentAlert()).toBeUndefined();
  });

  describe("on Android", () => {
    beforeEach(() => {
      jest.replaceProperty(Platform, "OS", "android");
    });

    it("draws the iOS-style dialog and runs the pressed button", async () => {
      const system = jest.spyOn(Alert, "alert").mockImplementation(() => {});
      const onRemove = jest.fn();
      const onCancel = jest.fn();
      await render(<AlertHost />);
      await act(async () => {
        alert("Remove?", "This cannot be undone.", [
          { text: "Remove", style: "destructive", onPress: onRemove },
          { text: "Cancel", style: "cancel", onPress: onCancel },
        ]);
      });
      expect(system).not.toHaveBeenCalled();
      expect(screen.getByText("Remove?")).toBeTruthy();
      await fireEvent.press(screen.getByText("Remove"));
      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();
      expect(screen.queryByText("Remove?")).toBeNull();
    });

    it("shows queued alerts one after another", async () => {
      await render(<AlertHost />);
      await act(async () => {
        alert("First");
        alert("Second");
      });
      expect(screen.getByText("First")).toBeTruthy();
      expect(screen.queryByText("Second")).toBeNull();
      await fireEvent.press(screen.getByText("OK"));
      expect(screen.getByText("Second")).toBeTruthy();
    });
  });
});

/**
 * #966: the system-link rewrite must only touch the Live Activity scanner
 * link; existing deep links (#935 company tags, the queue) pass through.
 */
import { redirectSystemPath } from "@/app/+native-intent";

const redirect = (path: string) => redirectSystemPath({ path, initial: false });

describe("redirectSystemPath (#966)", () => {
  it("opens the scanner bound to the activity (R008: no chooser)", () => {
    expect(redirect("hackos://scan?activity=7")).toBe("/activities/7");
    expect(redirectSystemPath({ path: "hackos://scan?activity=7", initial: true })).toBe(
      "/activities/7",
    );
  });

  it.each([
    "hackos://s/AbC123",
    "https://os.hackudc.com/s/AbC123",
    "https://os.hackudc.com/s/AbC123?utm=nfc",
    "hackos://queue",
    "hackos://scan",
    "hackos://activities/7",
    "/(tabs)/schedule",
    "",
  ])("passes %p through unchanged", (path) => {
    expect(redirect(path)).toBe(path);
  });
});

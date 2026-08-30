import { safeBack } from "./navigation";

describe("safeBack", () => {
  it("pops an existing stack entry", () => {
    const router = {
      back: jest.fn(),
      canGoBack: jest.fn(() => true),
      replace: jest.fn(),
    };

    safeBack(router, "/(tabs)/scan");

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("replaces a directly opened route with its owning surface", () => {
    const router = {
      back: jest.fn(),
      canGoBack: jest.fn(() => false),
      replace: jest.fn(),
    };

    safeBack(router, "/(tabs)/scan");

    expect(router.replace).toHaveBeenCalledWith("/(tabs)/scan");
    expect(router.back).not.toHaveBeenCalled();
  });
});

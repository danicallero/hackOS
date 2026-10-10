let mockCommit: unknown;
jest.mock("expo-application", () => ({ nativeApplicationVersion: "1.2.3" }));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: { buildCommit: mockCommit } };
    },
  },
}));

function versionLabel(commit: unknown) {
  mockCommit = commit;
  let label = "";
  jest.isolateModules(() => {
    label = require("./app-version").appVersionLabel;
  });
  return label;
}

it("shows the short build commit next to the native version", () => {
  expect(versionLabel("abcdef1234567890")).toBe("v1.2.3 · abcdef1");
});

it("keeps the version alone when build metadata is unavailable or invalid", () => {
  expect(versionLabel(undefined)).toBe("v1.2.3");
  expect(versionLabel("unknown")).toBe("v1.2.3");
});

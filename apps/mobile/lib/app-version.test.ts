let mockCommit: unknown;
let mockConfiguredVersion: string | undefined;
jest.mock("expo-application", () => ({ nativeApplicationVersion: "1.2.3" }));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { version: mockConfiguredVersion, extra: { buildCommit: mockCommit } };
    },
  },
}));

function versionLabel(commit: unknown, configuredVersion?: string) {
  mockCommit = commit;
  mockConfiguredVersion = configuredVersion;
  let label = "";
  jest.isolateModules(() => {
    label = require("./app-version").appVersionLabel;
  });
  return label;
}

it("shows the short build commit next to the configured app version", () => {
  expect(versionLabel("abcdef1234567890", "1.0.4")).toBe("v1.0.4 · abcdef1");
});

it("falls back to the native version when config or build metadata is unavailable", () => {
  expect(versionLabel(undefined)).toBe("v1.2.3");
  expect(versionLabel("unknown", "1.0.4")).toBe("v1.0.4");
});

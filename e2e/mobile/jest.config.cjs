/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  rootDir: "../..",
  testMatch: ["<rootDir>/e2e/mobile/**/*.e2e.js"],
  testTimeout: 120_000,
  maxWorkers: 1,
  globalSetup: "detox/runners/jest/globalSetup",
  globalTeardown: "detox/runners/jest/globalTeardown",
  reporters: ["detox/runners/jest/reporter"],
  testEnvironment: "detox/runners/jest/testEnvironment",
  verbose: true,
};

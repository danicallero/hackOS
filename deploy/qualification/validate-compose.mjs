#!/usr/bin/env node

import fs from "node:fs";

const expectedImage = process.argv[2];
if (!expectedImage) throw new Error("usage: validate-compose.mjs <release-image>");
if (!/@sha256:[a-f0-9]{64}$/.test(expectedImage)) {
  throw new Error("RELEASE_IMAGE must be an immutable @sha256:<64 hex> image digest");
}

const document = JSON.parse(fs.readFileSync(0, "utf8"));
const services = document.services ?? {};
const requiredServices = ["postgres", "valkey", "migrate", "api", "worker", "runner"];
const failures = [];

const fail = (message) => failures.push(message);
for (const service of requiredServices) {
  if (!services[service]) fail(`missing service ${service}`);
}

for (const [name, service] of Object.entries(services)) {
  if (service.ports?.length) fail(`${name} publishes host ports`);
  if (service.labels && Object.keys(service.labels).length) fail(`${name} has ingress labels`);
  if (service.build) fail(`${name} builds instead of using the release image`);
  const networks = Object.keys(service.networks ?? {});
  if (networks.some((network) => network !== "qualification")) {
    fail(`${name} joins a non-qualification network: ${networks.join(",")}`);
  }
}

const network = document.networks?.qualification;
if (network?.internal !== true) fail("qualification network is not internal");
if (Object.keys(document.networks ?? {}).some((name) => name !== "qualification")) {
  fail("compose declares a second network that could provide ingress");
}

for (const service of ["migrate", "api", "worker", "runner"]) {
  if (services[service]?.image !== expectedImage)
    fail(`${service} does not use RELEASE_IMAGE exactly`);
}

const environment = (service) => services[service]?.environment ?? {};
if (environment("api").NODE_ENV !== "test") fail("api NODE_ENV is not test");
if (environment("runner").NODE_ENV !== "test") fail("runner NODE_ENV is not test");
if (environment("runner").QUALIFICATION_STACK !== "1") fail("runner qualification marker missing");
if (services.worker?.healthcheck?.disable !== true) fail("worker healthcheck must be disabled");
if (
  environment("api").DATABASE_URL !==
  "postgres://hackos_qualification:qualification-only@postgres:5432/hackos_event_day_qualification"
) {
  fail("api DATABASE_URL is not the fixed qualification database");
}
if (!String(environment("runner").DATABASE_URL).includes("hackos_event_day_qualification")) {
  fail("runner DATABASE_URL is not the fixed qualification database");
}

const limits = (service) => services[service]?.deploy?.resources?.limits ?? {};
const normalizedLimit = (key, value) => {
  if (key === "cpus") return Number(value);
  const bytes = { "512m": "536870912", "1g": "1073741824", "2g": "2147483648" };
  return bytes[value] ?? value;
};
const expectedLimits = {
  api: { cpus: "2.0", memory: "1g" },
  runner: { cpus: "2.0", memory: "1g" },
  worker: { cpus: "2.0", memory: "512m" },
  postgres: { cpus: "2.0", memory: "2g" },
  valkey: { cpus: "1.0", memory: "512m" },
};
for (const [service, expected] of Object.entries(expectedLimits)) {
  for (const [key, value] of Object.entries(expected)) {
    if (String(limits(service)[key]) !== String(normalizedLimit(key, value))) {
      fail(`${service} ${key} limit must be ${value}`);
    }
  }
}

if (failures.length) {
  console.error(`qualification compose validation failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`qualification compose validated: ${expectedImage}`);

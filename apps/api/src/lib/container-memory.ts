import { readFile } from "node:fs/promises";
import client from "@prometheus-io/client";
import { register } from "./metrics.js";

const services = ["api", "worker", "postgres", "valkey", "minio", "web"] as const;
type Service = (typeof services)[number];
const gauge = (name: string, help: string) =>
  new client.Gauge({
    name: `hackos_service_${name}`,
    help,
    labelNames: ["service"],
    registers: [register],
  });
const available = gauge(
  "memory_sample_available",
  "Whether a valid memory sample is at most 45 seconds old",
);
const timestamp = gauge(
  "memory_sample_timestamp_seconds",
  "Time the container-local kernel memory sample was read",
);
const fields = {
  memory: gauge("memory_used_bytes", "Total cgroup memory charge including filesystem cache"),
  limit: gauge("memory_limit_bytes", "Cgroup RAM ceiling; -1 means unlimited"),
  swap: gauge("swap_used_bytes", "Current cgroup swap usage"),
  swap_limit: gauge("swap_limit_bytes", "Cgroup swap ceiling; -1 means unlimited"),
  reclaimable_cache: gauge(
    "memory_reclaimable_cache_bytes",
    "Inactive file cache; potentially reclaimable, not free RAM",
  ),
  limit_events: gauge(
    "memory_limit_events_total",
    "Cgroup memory max events since container creation",
  ),
  oom_events: gauge("memory_oom_events_total", "Cgroup OOM events since container creation"),
  oom_kills: gauge("memory_oom_kills_total", "Cgroup OOM kills since container creation"),
};
const workingSet = gauge(
  "memory_working_set_bytes",
  "Cgroup charge minus inactive file cache; not PostgreSQL private heap",
);
const keys = Object.keys(fields) as Array<keyof typeof fields>;
type MemorySample = Record<(typeof keys)[number] | "timestamp", number>;

export function parseMemorySample(input: string, now = Date.now() / 1000): MemorySample {
  const sample: unknown = JSON.parse(input);
  if (!sample || typeof sample !== "object" || Array.isArray(sample))
    throw new Error("Invalid memory sample");
  const values = sample as MemorySample;
  for (const key of ["timestamp", ...keys] as const) {
    const value = values[key];
    const minimum = key === "limit" || key === "swap_limit" ? -1 : 0;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
      throw new Error(`Invalid memory field: ${key}`);
  }
  if (values.timestamp > now + 5 || now - values.timestamp > 45)
    throw new Error("Expired memory sample");
  if (values.reclaimable_cache > values.memory) throw new Error("Cache exceeds memory charge");
  return values;
}

async function localSample(): Promise<string> {
  const values: Record<string, number> = { timestamp: Math.floor(Date.now() / 1000) };
  for (const [key, filename] of Object.entries({
    memory: "memory.current",
    limit: "memory.max",
    swap: "memory.swap.current",
    swap_limit: "memory.swap.max",
  })) {
    const raw = (await readFile(`/sys/fs/cgroup/${filename}`, "utf8")).trim();
    values[key] = raw === "max" ? -1 : Number(raw);
  }
  const stat = await readFile("/sys/fs/cgroup/memory.stat", "utf8");
  const events = await readFile("/sys/fs/cgroup/memory.events", "utf8");
  for (const [key, source, field] of [
    ["reclaimable_cache", stat, "inactive_file"],
    ["limit_events", events, "max"],
    ["oom_events", events, "oom"],
    ["oom_kills", events, "oom_kill"],
  ] as const) {
    const line = source.split("\n").find((entry) => entry.startsWith(`${field} `));
    values[key] = line ? Number(line.split(/\s+/)[1]) : Number.NaN;
  }
  return JSON.stringify(values);
}

/** No Docker/host access: local cgroup or one read-only per-service volume (#544). */
export async function refreshServiceMemory(local: "api" | "worker"): Promise<void> {
  const observed: Service[] =
    local === "api" ? services.filter((service) => service !== "worker") : ["worker"];
  await Promise.all(
    observed.map(async (service) => {
      try {
        const raw =
          service === local
            ? await localSample()
            : await readFile(`/run/hackos-memory/${service}/memory.json`, "utf8");
        const sample = parseMemorySample(raw);
        for (const key of keys) fields[key].set({ service }, sample[key]);
        workingSet.set({ service }, sample.memory - sample.reclaimable_cache);
        timestamp.set({ service }, sample.timestamp);
        available.set({ service }, 1);
      } catch {
        // Missing/dead collectors are unknown, not zero RAM or historical green.
        available.set({ service }, 0);
        for (const metric of Object.values(fields)) metric.remove({ service });
        workingSet.remove({ service });
        timestamp.remove({ service });
      }
    }),
  );
}

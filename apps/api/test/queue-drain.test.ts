import { afterEach, expect, it } from "vitest";
import { getQueue, registerWorker, startWorkers, stopQueues } from "../src/lib/queues.js";

let release: (() => void) | undefined;
afterEach(async () => {
  release?.();
  await stopQueues();
});

it("lets an accepted job enqueue follow-up work before producer queues close (H22/H29)", async () => {
  const name = `drain-${process.pid}-${Date.now()}`;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  registerWorker(name, async () => {
    started();
    await gate;
    await getQueue(name).add("follow-up", {}, { jobId: "follow-up" });
  });
  const queue = getQueue(name);
  await startWorkers();
  await queue.add("initial", {}, { jobId: "initial" });
  await entered;
  const draining = stopQueues();
  release?.();
  await draining;
  const reopened = getQueue(name);
  expect(await reopened.getJob("follow-up")).not.toBeUndefined();
  await reopened.obliterate({ force: true });
});

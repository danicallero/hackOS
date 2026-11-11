import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

/** #1283: keep CI logs useful while tests, compilation or teardown are busy. */
export default class ProgressReporter implements Reporter {
  private total = 0;
  private started = Date.now();
  private completed = new Map<string, { test: TestCase; result: TestResult }>();
  private active = new Map<string, { test: TestCase; started: number }>();
  private timer?: ReturnType<typeof setInterval>;

  onBegin(config: FullConfig, suite: Suite) {
    this.total = suite.allTests().length;
    this.started = Date.now();
    this.log(
      `Starting ${this.total} tests with ${config.workers} workers; retries=${config.projects[0]?.retries ?? 0}`,
    );
    this.timer = setInterval(() => this.progress(), 30_000);
  }

  onTestBegin(test: TestCase, result: TestResult) {
    this.completed.delete(test.id);
    this.active.set(test.id, { test, started: Date.now() });
    this.log(`START worker=${result.workerIndex} retry=${result.retry} ${this.name(test)}`);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.active.delete(test.id);
    this.completed.set(test.id, { test, result });
    this.log(
      `END ${result.status} ${(result.duration / 1000).toFixed(1)}s retry=${result.retry} ${this.name(test)}`,
    );
    this.progress();
  }

  onEnd(result: FullResult) {
    clearInterval(this.timer);
    this.log(`Finished: ${result.status}; elapsed=${(result.duration / 1000).toFixed(1)}s`);
    for (const { test, result } of [...this.completed.values()]
      .sort((a, b) => b.result.duration - a.result.duration)
      .slice(0, 10)) {
      this.log(`SLOW ${(result.duration / 1000).toFixed(1)}s ${this.name(test)}`);
    }
    this.log(
      "Browser execution complete; remaining job steps: upload diagnostics and runner cleanup. Other workflow jobs are shown in the Actions job list.",
    );
  }

  private progress() {
    const active = [...this.active.values()].map(
      ({ test, started }) => `${this.name(test)} (${Math.round((Date.now() - started) / 1000)}s)`,
    );
    this.log(
      `${this.completed.size}/${this.total} completed; ${this.total - this.completed.size} remaining; elapsed=${Math.round((Date.now() - this.started) / 1000)}s; active: ${active.join(" | ") || "none (between tests or cleaning up)"}`,
    );
  }

  private name(test: TestCase) {
    return test.titlePath().filter(Boolean).join(" > ");
  }

  private log(message: string) {
    console.log(`[browser ${new Date().toISOString()}] ${message}`);
  }
}

import { createServer, type Server } from "node:http";
import { config } from "../config.js";
import { refreshServiceMemory } from "./container-memory.js";
import { register } from "./metrics.js";

/** Small Prometheus endpoint for the dedicated worker process. */
export async function startMetricsServer(): Promise<Server> {
  const { METRICS_PORT: port, METRICS_HOST: host } = config;

  const server = createServer(async (request, response) => {
    if (request.url !== "/metrics") {
      response.writeHead(404).end();
      return;
    }
    await refreshServiceMemory("worker");
    response.writeHead(200, { "content-type": register.contentType });
    response.end(await register.metrics());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

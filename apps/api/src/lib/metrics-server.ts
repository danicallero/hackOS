import { createServer, type Server } from "node:http";
import { refreshServiceMemory } from "./container-memory.js";
import { register } from "./metrics.js";

/** Small Prometheus endpoint for the dedicated worker process. */
export async function startMetricsServer(): Promise<Server> {
  const port = Number(process.env.METRICS_PORT ?? 9464);
  const host = process.env.METRICS_HOST ?? "0.0.0.0";
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`METRICS_PORT must be a valid TCP port: ${process.env.METRICS_PORT}`);
  }

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

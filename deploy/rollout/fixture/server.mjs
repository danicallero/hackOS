import fs from "node:fs";
import http from "node:http";

const role = process.env.ROLE;
const port = { api: 3000, web: 3001, worker: 9464 }[role];
let active = 0;
const server = http.createServer(async (req, res) => {
  if (process.env.FIXTURE_UNHEALTHY) {
    res.writeHead(503).end();
    return;
  }
  active++;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.url.startsWith("/slow")) {
      fs.writeFileSync("/tmp/started", "yes");
      while (!fs.existsSync("/tmp/release"))
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    res.end(`${process.env.RELEASE}:${Buffer.concat(chunks).toString()}`);
  } finally {
    active--;
  }
});
server.listen(port, "0.0.0.0");
process.on("SIGTERM", () => {
  fs.writeFileSync("/tmp/stopping", "yes");
  server.close(() => process.exit(0));
  if (!active) process.exit(0);
});

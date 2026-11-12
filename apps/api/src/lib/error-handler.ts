import type { FastifyInstance } from "fastify";
import { dbTimeoutsTotal, isTimeoutError } from "./db-errors.js";
import { AppError } from "./errors.js";

/** Map AppError, validation and unexpected failures to the `{ error: { code, message } }` envelope. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      if (err.statusCode === 429 && "retryAfterSeconds" in err && err.retryAfterSeconds) {
        reply.header("retry-after", String(err.retryAfterSeconds));
      }
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details ?? undefined },
      });
    }
    if (typeof err === "object" && err !== null && "validation" in err) {
      return reply.code(400).send({
        error: {
          code: "validation",
          message: (err as { message?: string }).message ?? "Invalid request",
        },
      });
    }
    // Fastify's own request rejections (empty or malformed JSON body, unsupported
    // media type, oversized payload) are the client's fault, never a 500.
    const status = (err as { statusCode?: unknown } | null)?.statusCode;
    const code = (err as { code?: unknown } | null)?.code;
    if (
      typeof status === "number" &&
      status >= 400 &&
      status < 500 &&
      typeof code === "string" &&
      code.startsWith("FST_ERR_")
    ) {
      return reply.code(status).send({
        error: {
          code: "bad_request",
          message: (err as { message?: string }).message ?? "Invalid request",
        },
      });
    }
    if (isTimeoutError(err)) dbTimeoutsTotal.inc();
    req.log.error(err);
    return reply.code(500).send({
      error: { code: "internal", message: "Internal server error" },
    });
  });
}

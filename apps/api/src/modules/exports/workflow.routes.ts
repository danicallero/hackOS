import type { Readable } from "node:stream";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { SSE_TOPICS } from "@hackos/shared/events";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireCapability, userHasCapability } from "../../lib/capabilities.js";
import { ConflictError, ForbiddenError, UnauthorizedError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import { subscribe } from "../../lib/sse.js";
import { getObject } from "../../lib/storage.js";
import { createRequest, getRequest, listRequests, serializeRequest } from "./requests.service.js";
import {
  createRequestBody,
  listRequestsQuery,
  listRequestsResponseSchema,
  requestIdParam,
  requestResponseSchema,
} from "./schemas.js";
import { enqueueDataSubjectRequest } from "./worker.js";

/**
 * H54 staff workflow: file/track export or deletion requests for any user.
 * Creating a "deletion" request additionally requires ADMIN_ALL on top of the
 * route's EXPORTS_RUN guard — it's irreversible PII destruction, and the
 * existing direct anonymize route already reserves that action for ADMIN_ALL.
 */
export function registerWorkflowRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const requireExportRequestAccess: preHandlerHookHandler = async (req) => {
    if (req.userId == null) throw new UnauthorizedError();
    if (!(await userHasCapability(req.userId, CAPABILITIES.EXPORTS_RUN, req))) {
      throw new ForbiddenError(`Missing capability: ${CAPABILITIES.EXPORTS_RUN}`, {
        capability: CAPABILITIES.EXPORTS_RUN,
      });
    }
    if (
      (req.body as { type?: string } | undefined)?.type === "deletion" &&
      !(await userHasCapability(req.userId, CAPABILITIES.ADMIN_ALL, req))
    ) {
      throw new ForbiddenError(`Missing capability: ${CAPABILITIES.ADMIN_ALL}`, {
        capability: CAPABILITIES.ADMIN_ALL,
      });
    }
  };

  typed.post(
    "/api/exports/requests",
    {
      preHandler: [requireExportRequestAccess, idempotencyGuard],
      config: routeAccess({
        kind: "contextual",
        policy: "export-request-create",
        resource: { source: "body", field: "subjectUserId" },
      }),
      schema: { body: createRequestBody, response: { 201: requestResponseSchema } },
    },
    async (req, reply) => {
      const row = await createRequest({
        subjectUserId: req.body.subjectUserId,
        requestedBy: req.userId as number,
        type: req.body.type,
        reason: req.body.reason,
      });
      await enqueueDataSubjectRequest(row.id);
      reply.code(201);
      return serializeRequest(row);
    },
  );

  typed.get(
    "/api/exports/requests",
    {
      preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.EXPORTS_RUN }),
      schema: { querystring: listRequestsQuery, response: { 200: listRequestsResponseSchema } },
    },
    async (req) => {
      const { limit, offset, ...filter } = req.query;
      const { items, total } = await listRequests({ ...filter, limit, offset });
      return { items: items.map(serializeRequest), total };
    },
  );

  typed.get(
    "/api/exports/requests/:id",
    {
      preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.EXPORTS_RUN }),
      schema: { params: requestIdParam, response: { 200: requestResponseSchema } },
    },
    async (req) => serializeRequest(await getRequest(req.params.id)),
  );

  // Proxied bundle download (not a presigned URL) — the EXPORTS_RUN check
  // runs on THIS request, mirroring apps/api/src/modules/applications/upload.routes.ts.
  typed.get(
    "/api/exports/requests/:id/download",
    {
      preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.EXPORTS_RUN }),
      schema: { params: requestIdParam },
    },
    async (req, reply) => {
      const row = await getRequest(req.params.id);
      if (row.type !== "export" || row.status !== "completed" || !row.storage_key) {
        throw new ConflictError("Request is not a completed export", {
          status: row.status,
          type: row.type,
        });
      }
      const obj = await getObject(row.storage_key);
      if (!obj.Body)
        throw new ConflictError("Export bundle is missing from storage", { id: row.id });

      reply.header("content-type", "application/json");
      reply.header(
        "content-disposition",
        `attachment; filename="export-user-${row.subject_user_id}-${row.id}.json"`,
      );
      reply.header("cache-control", "private, no-store");
      return reply.send(obj.Body as Readable);
    },
  );

  typed.get(
    "/api/exports/stream",
    {
      preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.EXPORTS_RUN }),
    },
    async (req, reply) => {
      await subscribe(SSE_TOPICS.EXPORTS, req, reply);
    },
  );
}

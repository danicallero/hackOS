import type { Capability } from "@hackos/shared/capabilities";
import type { FastifyRequest, preHandlerHookHandler } from "fastify";
import { userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";

/**
 * Several queue actions are legitimately reachable from more than one
 * capability (e.g. notify_enter and no_show are both a judge-view action
 * AND an operator-view action). This guard passes if the caller holds ANY
 * of the listed capabilities.
 */
export function requireAnyCapability(...capabilities: Capability[]): preHandlerHookHandler {
  return async (req: FastifyRequest) => {
    if (req.userId == null) throw new UnauthorizedError();
    for (const cap of capabilities) {
      if (await userHasCapability(req.userId, cap)) return;
    }
    throw new ForbiddenError(`Missing one of capabilities: ${capabilities.join(", ")}`, {
      capabilities,
    });
  };
}

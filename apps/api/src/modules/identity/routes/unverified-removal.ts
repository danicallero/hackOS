import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { RouteAccessPolicy } from "../../../lib/route-policy.js";
import { describeUnverifiedRemoval, removeUnverifiedAccount } from "../unverified-removal.js";

/**
 * "I didn't create this account" (H1, H54): the token-scoped deletion behind
 * the link in every verification reminder. See ../unverified-removal.ts.
 */
export function registerUnverifiedRemovalRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const config = {
    routeAccessPolicy: {
      kind: "token",
      policy: "unverified-account-removal",
      emailVerification: "none",
    } satisfies RouteAccessPolicy,
  };
  const tokenSchema = z.string().min(20).max(128);

  api.get(
    "/api/unverified-account-removal",
    {
      config,
      schema: {
        summary: "Show which unverified account a removal link would delete",
        description:
          "Read-only (H1, H54): resolves the single-use token from a verification reminder email to the address of the account it deletes, and whether confirming needs its password (accounts without one do not), so the page can ask for confirmation. Fails with `removal_link_invalid` for an unknown, used or expired token, and `account_already_verified` once the address has been verified.",
        querystring: z.object({ token: tokenSchema }),
        response: { 200: z.object({ email: z.string(), passwordRequired: z.boolean() }) },
      },
    },
    async (req) => describeUnverifiedRemoval(req.query.token),
  );

  api.post(
    "/api/unverified-account-removal",
    {
      config,
      schema: {
        summary: "Delete an unverified account from an emailed link",
        description:
          "H1, H54: permanently deletes the account named by a verification reminder's single-use token. No emailed security PIN (the address is unverified), but the account's current password is required when it has one, checked under the same user-row lock as every self-service removal; limited to 10 attempts per hour per account. Verified accounts are refused with `account_already_verified` and must use the regular removal flow.",
        body: z
          .object({ token: tokenSchema, password: z.string().min(1).max(128).optional() })
          .strict(),
        response: { 200: z.object({ deleted: z.literal(true) }) },
      },
    },
    async (req) => {
      await removeUnverifiedAccount(req.body.token, req.body.password);
      return { deleted: true as const };
    },
  );
}

import type { FastifyInstance } from "fastify";
import { registerCertificateRoutes } from "./routes.js";

/** #1083: attendance certificates issued by the organisation, verifiable by code. */
export function registerCertificatesModule(app: FastifyInstance): void {
  registerCertificateRoutes(app);
}

import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { replaceLibraryAnswers } from "./service.js";

const params = z.object({ id: z.uuid() });
const name = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .transform((value) => value.replace(/\s+/g, " "));
const body = z.object({
  renames: z.array(z.object({ id: z.number().int().positive(), name })).default([]),
  deleteIds: z.array(z.number().int().positive()).default([]),
  merge: z
    .object({
      sourceIds: z.array(z.number().int().positive()),
      targetId: z.number().int().positive(),
    })
    .optional(),
});

export function registerFormLibrariesModule(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/api/form-libraries/:id",
    {
      preHandler: requireAuth,
      config: { routeAccessPolicy: { kind: "authenticated" } },
      schema: {
        params,
        summary: "Read a question library",
        description:
          "Authenticated catalogue for one dynamic question. Entries are scoped to the caller’s fixture boundary. No per-user proposal or selection limit (H11/H16).",
      },
    },
    async (q) => {
      const exists = await pool.query(`SELECT 1 FROM form_libraries WHERE id=$1`, [q.params.id]);
      if (!exists.rowCount) throw new NotFoundError("Field library not found");
      const { rows } = await pool.query(
        `SELECT id,name FROM form_library_values WHERE library_id=$1 AND is_test_account=(SELECT is_test_account FROM users WHERE id=$2) ORDER BY lower(name),id`,
        [q.params.id, q.userId],
      );
      return { items: rows };
    },
  );
  r.post(
    "/api/form-libraries/:id/proposals",
    {
      preHandler: [requireAuth, idempotencyGuard],
      config: { routeAccessPolicy: { kind: "authenticated" } },
      schema: {
        params,
        body: z.object({ name }),
        summary: "Propose a question library value",
        description:
          "Creates or reuses a case-insensitive normalized value in this question only. No quota on how many values a participant may propose. Audited atomically (H11/H16/H53).",
      },
    },
    async (q) =>
      withTransaction(async (db) => {
        const locked = await db.query(`SELECT id FROM form_libraries WHERE id=$1 FOR UPDATE`, [
          q.params.id,
        ]);
        if (!locked.rowCount) throw new NotFoundError("Field library not found");
        const { rows } = await db.query(
          `INSERT INTO form_library_values(library_id,name,is_test_account) SELECT $1,$2,is_test_account FROM users WHERE id=$3 ON CONFLICT(library_id,lower(name),is_test_account) DO UPDATE SET name=form_library_values.name RETURNING id,name`,
          [q.params.id, q.body.name, q.userId],
        );
        await audit(db, {
          actorId: q.userId,
          entityType: "form_library",
          entityId: q.params.id,
          action: "propose",
          after: { id: rows[0].id, name: rows[0].name },
        });
        return rows[0];
      }),
  );
  for (const project of [true, false]) {
    const capability = project ? CAPABILITIES.PROJECTS_EDIT : CAPABILITIES.APPLICATIONS_MANAGE;
    r.post(
      project
        ? "/api/projects/form/libraries/:id/manage"
        : "/api/applications/:applicationId/libraries/:id/manage",
      {
        preHandler: [requireCapability(capability), idempotencyGuard],
        config: { routeAccessPolicy: { kind: "capability", capability } },
        schema: {
          params: project
            ? params
            : params.extend({ applicationId: z.coerce.number().int().positive() }),
          body,
          summary: "Curate a question library in bulk",
          description:
            "Renames, deletes or merges values for one field belonging to this form. Updates working answers, preserves submitted snapshots, locks the catalogue and audits the whole batch in one transaction (H11/H16/H53).",
        },
      },
      async (q) =>
        withTransaction(async (db) => {
          const { rows } = await db.query(
            `SELECT l.*,u.is_test_account AS fixture FROM form_libraries l JOIN users u ON u.id=$4 WHERE l.id=$1 AND l.project=$2 AND l.application_id IS NOT DISTINCT FROM $3 FOR UPDATE OF l`,
            [
              q.params.id,
              project,
              "applicationId" in q.params ? q.params.applicationId : null,
              q.userId,
            ],
          );
          const library = rows[0];
          if (!library) throw new NotFoundError("Field library not found");
          const values = await db.query(
            `SELECT id,name FROM form_library_values WHERE library_id=$1 AND is_test_account=(SELECT is_test_account FROM users WHERE id=$2) FOR UPDATE`,
            [q.params.id, q.userId],
          );
          const ids = [
            ...q.body.renames.map((item) => item.id),
            ...q.body.deleteIds,
            ...(q.body.merge ? [q.body.merge.targetId, ...q.body.merge.sourceIds] : []),
          ];
          if (ids.some((id) => !values.rows.some((item) => item.id === id)))
            throw new NotFoundError("Library value not found");
          const before = structuredClone(values.rows.filter((row) => ids.includes(row.id)));
          for (const item of q.body.renames) {
            if (
              values.rows.some(
                (other) =>
                  other.id !== item.id &&
                  other.name.toLocaleLowerCase() === item.name.toLocaleLowerCase(),
              )
            )
              throw new BadRequestError(
                "Merge duplicate library values instead of renaming them to the same name",
              );
            const before = values.rows.find((row) => row.id === item.id)!;
            await replaceLibraryAnswers(db, library, before.name, item.name);
            await db.query(`UPDATE form_library_values SET name=$2 WHERE id=$1`, [
              item.id,
              item.name,
            ]);
            before.name = item.name;
          }
          const deleting = new Set(q.body.deleteIds);
          if (q.body.merge) {
            if (
              q.body.merge.sourceIds.includes(q.body.merge.targetId) ||
              deleting.has(q.body.merge.targetId)
            )
              throw new BadRequestError("Choose a retained value for merging");
            const target = values.rows.find((row) => row.id === q.body.merge!.targetId)!;
            for (const id of q.body.merge.sourceIds) {
              await replaceLibraryAnswers(
                db,
                library,
                values.rows.find((row) => row.id === id)!.name,
                target.name,
              );
              deleting.add(id);
            }
          }
          for (const id of q.body.deleteIds)
            await replaceLibraryAnswers(
              db,
              library,
              values.rows.find((row) => row.id === id)!.name,
              null,
            );
          if (deleting.size)
            await db.query(`DELETE FROM form_library_values WHERE id=ANY($1::int[])`, [
              [...deleting],
            ]);
          await audit(db, {
            actorId: q.userId,
            entityType: "form_library",
            entityId: q.params.id,
            action: "curate",
            before,
            after: q.body,
          });
          return { ok: true };
        }),
    );
  }
}

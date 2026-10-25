import { ERROR_REASONS } from "@hackos/shared/error-reasons";
import { projectDescriptionField } from "@hackos/shared/forms";
import type { ProjectForm } from "@hackos/shared/projects";
import { youtubeEmbedUrl } from "@hackos/shared/youtube";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { validateResponses } from "../applications/service.js";
import { visibleWinnerRows } from "../challenges/winner-publication.js";
import { syncFieldLibraries, validateLibraryAnswers } from "../form-libraries/service.js";
import { hasEventAccess } from "../identity/role.js";
import { assertQueueRepoScope } from "../queue/fixture-scope.js";
import { repositoryAccessForUser, repositoryIdsForScope } from "./access.js";
import { assertProjectWindow, canViewProject, projectPhase } from "./policy.js";

/** File answers are one key; photo-list answers (H16) are several. */
function responseFileKeys(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  return Array.isArray(value) ? value.filter((key) => typeof key === "string") : [];
}
export async function nativeMember(db: Queryable, userId: number, id: number) {
  const result = await db.query(
    `SELECT 1 FROM submissions s JOIN users u ON u.id=s.user_id JOIN repos r ON r.id=s.repo_id AND r.is_test_account=u.is_test_account WHERE repo_id=$1 AND user_id=$2 AND status='active' AND u.account_state='active' AND u.anonymized_at IS NULL`,
    [id, userId],
  );
  if (!result.rowCount) throw new ForbiddenError("Not an active project member");
}
export async function nativeEditable(
  db: Queryable,
  userId: number,
  id: number,
  { allowSubmitted = false }: { allowSubmitted?: boolean } = {},
) {
  const result = await db.query(`SELECT * FROM repos WHERE id=$1 FOR UPDATE`, [id]);
  const project = result.rows[0];
  if (!project) throw new NotFoundError("Project not found");
  await nativeMember(db, userId, id);
  if (project.lock_reason === "organizer_lock")
    throw new ConflictError("Project is locked; request edits");
  if (!(project.submitted_at && project.submission_status === "draft"))
    await assertProjectWindow(db);
  // H20/H21: a submitted project is the presented project; participants withdraw it to edit.
  if (project.submission_status === "submitted" && !allowSubmitted)
    throw new ConflictError("Withdraw the submission to edit the project", {
      code: ERROR_REASONS.PROJECT_FROZEN,
    });
  return project;
}
export async function nativeForm(db: Queryable = pool) {
  const { rows } = await db.query(
    `SELECT id AS version,template,sections FROM project_form_versions ORDER BY id DESC LIMIT 1`,
  );
  return rows[0];
}
/** H20/H21: corrections append a new authoritative version; historical submissions stay immutable. */
export async function snapshotProjectSubmission(
  db: Queryable,
  actorId: number,
  id: number,
  formVersion: number | null,
  source: "native" | "admin",
) {
  await db.query(
    `INSERT INTO project_submission_versions(repo_id,actor_id,source,form_version_id,snapshot)
     SELECT id,$2,$3,$4,jsonb_build_object('project',to_jsonb(r),'members',(SELECT jsonb_agg(to_jsonb(s)) FROM submissions s WHERE s.repo_id=r.id AND s.status='active'),'challenges',(SELECT jsonb_agg(challenge_id) FROM project_challenges c WHERE c.repo_id=r.id)) FROM repos r WHERE id=$1`,
    [id, actorId, source, formVersion],
  );
}
export async function saveNativeForm(actorId: number, form: ProjectForm) {
  return withTransaction(async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('project-form',0))`);
    const before = await nativeForm(db);
    const template = await syncFieldLibraries(db, null, form.template, form.library_deletions);
    const { rows } = await db.query(
      `INSERT INTO project_form_versions(template,sections,created_by) VALUES($1,$2,$3) RETURNING id AS version,template,sections`,
      [JSON.stringify(template), JSON.stringify(form.sections), actorId],
    );
    // H16: a field newly chosen as the description takes over projects that already answered it.
    const descriptionField = projectDescriptionField(template);
    if (descriptionField)
      await db.query(
        `UPDATE repos SET description=btrim(responses->>$1) WHERE jsonb_typeof(responses->$1)='string' AND btrim(responses->>$1)<>'' AND description IS DISTINCT FROM btrim(responses->>$1)`,
        [descriptionField.key],
      );
    await audit(db, {
      actorId,
      entityType: "project_form",
      entityId: rows[0].version,
      action: "update",
      before,
      after: rows[0],
    });
    return rows[0];
  });
}
export async function saveNativeDraft(
  userId: number,
  id: number,
  responses: Record<string, unknown>,
  revision: number,
  staff = false,
) {
  return withTransaction(async (db) => {
    const before = staff
      ? (await db.query(`SELECT * FROM repos WHERE id=$1 FOR UPDATE`, [id])).rows[0]
      : await nativeEditable(db, userId, id);
    if (!before) throw new NotFoundError("Project not found");
    if (staff) await assertQueueRepoScope(db, userId, id);
    if (before.draft_revision !== revision)
      throw new ConflictError("A newer project draft exists", { revision: before.draft_revision });
    // H16: the description field's answer is the project's description everywhere.
    const form = await nativeForm(db);
    const draftTemplate = form?.template ?? [];
    await validateLibraryAnswers(db, draftTemplate, responses, userId);
    const descriptionField = projectDescriptionField(draftTemplate);
    const description = descriptionField ? responses[descriptionField.key] : undefined;
    const { rows } = await db.query(
      `UPDATE repos SET responses=$2,draft_revision=draft_revision+1,description=COALESCE($3,description) WHERE id=$1 RETURNING responses,draft_revision AS revision`,
      [id, JSON.stringify(responses), typeof description === "string" ? description.trim() : null],
    );
    if (staff && before.submission_status === "submitted")
      await snapshotProjectSubmission(db, userId, id, form?.version ?? null, "admin");
    await audit(db, {
      actorId: userId,
      entityType: "project",
      entityId: id,
      action: "save_draft",
      source: staff ? "admin" : "participant",
      before: { revision },
      after: { revision: rows[0].revision },
    });
    return rows[0];
  });
}
export async function createNativeDraft(
  userId: number,
  input: {
    name: string;
    description?: string;
    githubUrl?: string | null;
    demoUrl?: string | null;
    challengeIds?: number[];
  },
) {
  return withTransaction(async (db) => {
    await assertProjectWindow(db);
    if (!(await hasEventAccess(db, userId))) throw new ForbiddenError("Event access required");
    const selected = input.challengeIds ?? [];
    if (selected.length) {
      const visible = await db.query(
        `SELECT c.id FROM challenges c JOIN users u ON u.id=$2 WHERE c.id=ANY($1::int[]) AND c.visibility='visible' AND c.is_test_account=u.is_test_account`,
        [selected, userId],
      );
      if (new Set(visible.rows.map((row) => row.id)).size !== new Set(selected).size)
        throw new NotFoundError("Challenge not found");
    }
    const { rows } = await db.query(
      `INSERT INTO repos(name,description,github_url,demo_url,created_by,submission_status,is_test_account) SELECT $1,$2,$3,$4,id,'draft',is_test_account FROM users WHERE id=$5 RETURNING id`,
      [input.name, input.description ?? "", input.githubUrl ?? null, input.demoUrl ?? null, userId],
    );
    const id = rows[0].id;
    await db.query(`INSERT INTO submissions(repo_id,user_id,status) VALUES($1,$2,'active')`, [
      id,
      userId,
    ]);
    await db.query(
      `INSERT INTO project_challenges(repo_id,challenge_id) SELECT $1,id FROM challenges WHERE (id=ANY($2::int[]) OR mandatory) AND is_test_account=(SELECT is_test_account FROM repos WHERE id=$1) ON CONFLICT DO NOTHING`,
      [id, input.challengeIds ?? []],
    );
    await audit(db, {
      actorId: userId,
      entityType: "project",
      entityId: id,
      action: "create",
      source: "participant",
      after: input,
    });
    return { id };
  });
}
export async function submitNativeProject(userId: number, id: number) {
  return withTransaction(async (db) => {
    const project = await nativeEditable(db, userId, id, { allowSubmitted: true });
    if (
      !(project.submitted_at && project.submission_status === "draft") &&
      !(await projectPhase(db)).submitting
    )
      throw new ForbiddenError("Project submissions are closed");
    const form = await nativeForm(db);
    validateResponses(form.template, project.responses);
    await validateLibraryAnswers(db, form.template, project.responses, userId);
    const github = await db.query(
      `SELECT (SELECT project_github_required FROM event_config WHERE id=1) AS required,
              (EXISTS (SELECT 1 FROM github_repo_links WHERE repo_id=$1) OR COALESCE(trim($2),'')<>'') AS linked`,
      [id, project.github_url],
    );
    if (github.rows[0].required && !github.rows[0].linked)
      throw new BadRequestError("A GitHub repository is required to submit", {
        code: ERROR_REASONS.PROJECT_GITHUB_REQUIRED,
      });
    for (const field of form.template) {
      if (
        field.project_video &&
        project.responses[field.key] &&
        !youtubeEmbedUrl(project.responses[field.key])
      )
        throw new BadRequestError("Invalid YouTube video URL");
    }
    const { rows } = await db.query(
      `SELECT count(*)::int AS count,(SELECT project_max_team_size FROM event_config WHERE id=1) AS maximum FROM submissions WHERE repo_id=$1 AND status='active'`,
      [id],
    );
    if (rows[0].maximum && rows[0].count > rows[0].maximum && !project.team_size_exception)
      throw new BadRequestError("Project exceeds maximum team size");
    const expectedKeys = new Map<string, Set<string>>();
    for (const field of form.template) {
      if (field.kind !== "file" && field.kind !== "images") continue;
      const keys = responseFileKeys(project.responses[field.key]);
      if (keys.length) expectedKeys.set(field.key, new Set(keys));
    }
    if (expectedKeys.size > 0) {
      const pairs = [...expectedKeys].flatMap(([fieldKey, keys]) =>
        [...keys].map((objectKey) => ({ fieldKey, objectKey })),
      );
      const owned = await db.query(
        `SELECT p.field_key, count(DISTINCT pf.object_key)::int AS count
           FROM unnest($2::text[], $3::text[]) AS p(field_key, object_key)
           JOIN project_files pf
             ON pf.repo_id=$1 AND pf.field_key=p.field_key AND pf.object_key=p.object_key
          GROUP BY p.field_key`,
        [id, pairs.map((pair) => pair.fieldKey), pairs.map((pair) => pair.objectKey)],
      );
      const ownedCounts = new Map<string, number>(
        owned.rows.map((row: { field_key: string; count: number }) => [row.field_key, row.count]),
      );
      for (const [fieldKey, keys] of expectedKeys)
        if ((ownedCounts.get(fieldKey) ?? 0) !== keys.size)
          throw new BadRequestError("File does not belong to this project");
    }
    await db.query(
      `UPDATE repos SET submission_status='submitted',submitted_at=now(),submitted_via='native',locked_at=now(),lock_reason='native_submission' WHERE id=$1`,
      [id],
    );
    await snapshotProjectSubmission(db, userId, id, form.version, "native");
    await audit(db, {
      actorId: userId,
      entityType: "project",
      entityId: id,
      action: "submit",
      source: "participant",
      after: { formVersion: form.version },
    });
    return { id, submissionStatus: "submitted" };
  });
}
/** H20/H21: inside the submission window a team takes its project back to draft, edits it and resubmits. */
export async function withdrawNativeSubmission(userId: number, id: number) {
  return withTransaction(async (db) => {
    const project = await nativeEditable(db, userId, id, { allowSubmitted: true });
    if (project.submission_status !== "submitted")
      throw new ConflictError("Project is not submitted");
    if (!(await projectPhase(db)).submitting)
      throw new ForbiddenError("Project submissions are closed");
    // A plain draft again: clearing submitted_at keeps the deadline binding (no approved reopening).
    await db.query(
      `UPDATE repos SET submission_status='draft',submitted_at=NULL,locked_at=NULL,lock_reason=NULL WHERE id=$1`,
      [id],
    );
    await audit(db, {
      actorId: userId,
      entityType: "project",
      entityId: id,
      action: "withdraw_submission",
      source: "participant",
      before: { submissionStatus: "submitted" },
    });
    return { id, submissionStatus: "draft" };
  });
}
export async function nativeProject(
  userId: number | null,
  id: number,
  options: { gallery?: boolean } = {},
) {
  if (!(await canViewProject(pool, userId, id))) throw new NotFoundError("Project not found");
  return (await nativeProjects(userId, [id], options))[0];
}
/** Bounded batch projection: list size never multiplies SQL queries (#1009). */
export async function nativeProjects(
  userId: number | null,
  ids: number[],
  {
    staff = false,
    gallery = false,
    /** Gallery access was already verified for every viewer of this projection (shared cache, H18). */
    galleryChecked = false,
  }: { staff?: boolean; gallery?: boolean; galleryChecked?: boolean } = {},
) {
  if (!ids.length) return [];
  let inspectable = new Set<number>();
  if (userId !== null) {
    try {
      const scope = await repositoryAccessForUser(userId);
      inspectable = new Set(scope.fullAccess ? ids : await repositoryIdsForScope(scope));
      if (scope.fullAccess && !gallery) staff = true;
    } catch (error) {
      if (!(error instanceof ForbiddenError)) throw error;
    }
  }
  const [projects, members, challenges, files, phase, currentForm, winnerRows] = await Promise.all([
    pool.query(
      `SELECT r.id,r.name,r.description,r.github_url AS "githubUrl",r.demo_url AS "demoUrl",r.submission_status AS "submissionStatus",r.presentation_timing_preference AS "presentationTimingPreference",r.responses,r.lock_reason AS "lockReason",r.submitted_at AS "submittedAt",r.draft_revision AS revision,v.snapshot,v.form_version_id AS "snapshotFormVersion",f.template AS "snapshotTemplate",f.sections AS "snapshotSections",
 EXISTS(SELECT 1 FROM submissions s WHERE s.repo_id=r.id AND s.user_id=$2 AND s.status='active') AS member
 FROM repos r LEFT JOIN LATERAL(SELECT * FROM project_submission_versions v WHERE v.repo_id=r.id ORDER BY v.id DESC LIMIT 1) v ON true LEFT JOIN project_form_versions f ON f.id=v.form_version_id WHERE r.id=ANY($1::int[])`,
      [ids, userId],
    ),
    pool.query(
      `SELECT s.repo_id,s.user_id AS "userId",u.name,u.surname,s.status,u.gallery_show_name,COALESCE(p.directory_visible AND p.show_surname AND p.consented_at IS NOT NULL,false) AS "surnameShared",COALESCE(p.directory_visible AND p.show_photo AND p.consented_at IS NOT NULL,false) AS "photoShared",u.photo_key FROM submissions s JOIN users u ON u.id=s.user_id LEFT JOIN user_public_profiles p ON p.user_id=u.id WHERE s.repo_id=ANY($1::int[]) AND u.account_state='active' AND u.anonymized_at IS NULL ORDER BY s.created_at`,
      [ids],
    ),
    pool.query(
      `SELECT pc.repo_id,c.id,c.title,c.mandatory,c.visibility,qe.status,qe.position,qe.assigned_room_id AS "assignedRoomId",room.name AS "assignedRoomName" FROM project_challenges pc JOIN challenges c ON c.id=pc.challenge_id LEFT JOIN queue_entries qe ON qe.repo_id=pc.repo_id AND qe.challenge_id=c.id LEFT JOIN rooms room ON room.id=qe.assigned_room_id WHERE pc.repo_id=ANY($1::int[]) ORDER BY c.id`,
      [ids],
    ),
    pool.query(
      `SELECT repo_id,object_key,field_key,filename,mime_type,size_bytes,thumbnail_key FROM project_files WHERE repo_id=ANY($1::int[])`,
      [ids],
    ),
    projectPhase(pool),
    nativeForm(),
    visibleWinnerRows(pool, userId, ids, galleryChecked),
  ]);
  return ids.map((id) => {
    const row = projects.rows.find((project) => project.id === id);
    if (!row) throw new NotFoundError("Project not found");
    const {
      member: ownMember,
      snapshot,
      snapshotFormVersion,
      snapshotTemplate,
      snapshotSections,
      ...project
    } = row;
    const member = ownMember || staff;
    const privateView = member && !gallery;
    const reopened = Boolean(project.submittedAt && project.submissionStatus === "draft");
    const participantCanEdit =
      project.lockReason !== "organizer_lock" &&
      project.submissionStatus !== "submitted" &&
      (phase.editing || reopened);
    const submitted =
      (gallery || !member) && project.submissionStatus === "submitted" && snapshot?.project;
    const content = submitted
      ? {
          name: snapshot.project.name,
          description: snapshot.project.description,
          // The repo link is verified metadata, so the live value wins over the snapshot's:
          // a repository changed after submitting (or after judging) shows right away.
          githubUrl: project.githubUrl ?? snapshot.project.github_url,
          demoUrl: snapshot.project.demo_url,
          responses: snapshot.project.responses,
        }
      : {};
    const form =
      submitted && snapshotTemplate
        ? { version: snapshotFormVersion, template: snapshotTemplate, sections: snapshotSections }
        : currentForm;
    const answers = content.responses ?? project.responses;
    // H16: projects described before the field existed (or imported) show that
    // text in their description field instead of an empty answer.
    const descriptionField = projectDescriptionField(form?.template ?? []);
    const currentDescription = content.description ?? project.description;
    const responses =
      descriptionField &&
      !(
        typeof answers?.[descriptionField.key] === "string" && answers[descriptionField.key].trim()
      ) &&
      currentDescription
        ? { ...answers, [descriptionField.key]: currentDescription }
        : answers;
    const answer = descriptionField ? responses?.[descriptionField.key] : undefined;
    return {
      ...project,
      isMember: ownMember,
      canInspect: inspectable.has(id),
      ...content,
      // H16: the description field's answer is the description, even if the
      // stored column was written before the field existed.
      ...(typeof answer === "string" && answer.trim() ? { description: answer.trim() } : {}),
      responses,
      formVersion: form?.version ?? null,
      template: form?.template ?? [],
      sections: form?.sections ?? [],
      canEdit: ownMember && participantCanEdit,
      canSubmit:
        ownMember && project.lockReason !== "organizer_lock" && (phase.submitting || reopened),
      canInvite: ownMember && participantCanEdit,
      canWithdraw:
        ownMember &&
        project.submissionStatus === "submitted" &&
        project.lockReason !== "organizer_lock" &&
        phase.submitting,
      ...(winnerRows.some((w) => w.repoId === id)
        ? {
            winners: winnerRows
              .filter((w) => w.repoId === id)
              .map(({ repoId, repoName, ...winner }) => {
                void repoId;
                void repoName;
                return winner;
              }),
          }
        : {}),
      members: members.rows
        .filter((m) => m.repo_id === id && (privateView || m.status === "active"))
        .map((m) => ({
          userId: m.userId,
          name: privateView || m.gallery_show_name ? m.name : null,
          // H18: the public profile's surname setting applies in the gallery too.
          surname: privateView || m.surnameShared ? m.surname : null,
          status: m.status,
          photoUrl:
            // H18: a member's photo follows their public profile's photo setting.
            m.photoShared && m.photo_key
              ? `/api/public/projects/${id}/members/${m.userId}/photo`
              : null,
        })),
      challenges: challenges.rows
        .filter(
          (c) =>
            c.repo_id === id &&
            (privateView || (!gallery && inspectable.has(id)) || c.visibility === "visible"),
        )
        .map(({ repo_id, visibility, ...challenge }) => {
          void repo_id;
          void visibility;
          return challenge;
        }),
      presentations: challenges.rows.filter(
        (c) => c.repo_id === id && c.status !== null && (member || inspectable.has(id)),
      ),
      files: files.rows
        .filter(
          (f) =>
            f.repo_id === id &&
            Object.values(responses).flatMap(responseFileKeys).includes(f.object_key),
        )
        .map((f) => ({
          objectKey: f.object_key,
          fieldKey: f.field_key,
          fileName: f.filename,
          mimeType: f.mime_type,
          size: f.size_bytes,
          url: `/api/public/projects/${id}/files?key=${encodeURIComponent(f.object_key)}`,
          thumbnailUrl: f.thumbnail_key
            ? `/api/public/projects/${id}/files?key=${encodeURIComponent(f.object_key)}&thumbnail=true`
            : null,
        })),
    };
  });
}

export async function requestNativeEdits(userId: number, id: number, reason: string) {
  return withTransaction(async (db) => {
    await db.query(`SELECT id FROM repos WHERE id=$1 FOR UPDATE`, [id]);
    await nativeMember(db, userId, id);
    const { rows } = await db.query(
      `INSERT INTO project_edit_requests(repo_id,requested_by,reason) VALUES($1,$2,$3) ON CONFLICT(repo_id) WHERE status='pending' DO UPDATE SET reason=excluded.reason RETURNING id,status`,
      [id, userId, reason],
    );
    await audit(db, {
      actorId: userId,
      entityType: "project",
      entityId: id,
      action: "request_edits",
      reason,
    });
    return rows[0];
  });
}
export async function decideNativeEdits(
  actorId: number,
  id: number,
  reason: string,
  decision: "approve" | "deny" | "unlock",
) {
  return withTransaction(async (db) => {
    const { rows } = await db.query(`SELECT * FROM repos WHERE id=$1 FOR UPDATE`, [id]);
    if (!rows[0]) throw new NotFoundError("Project not found");
    if (decision !== "deny")
      await db.query(
        `UPDATE repos SET submission_status='draft',locked_at=NULL,lock_reason=NULL WHERE id=$1`,
        [id],
      );
    await db.query(
      `UPDATE project_edit_requests SET status=$2,decided_by=$3,decision_reason=$4,decided_at=now() WHERE repo_id=$1 AND status='pending'`,
      [id, decision === "deny" ? "denied" : "approved", actorId, reason],
    );
    await audit(db, {
      actorId,
      entityType: "project",
      entityId: id,
      action: "decide_edits",
      reason,
      before: { submissionStatus: rows[0].submission_status },
      after: { decision },
    });
    return { id, decision };
  });
}

export async function projectEstimates(challengeIds: number[] | "all", fixtureMarker = false) {
  const { rows } = await pool.query(
    `SELECT c.id AS "challengeId",c.title,c.mandatory,
 (SELECT count(DISTINCT r.id)::int FROM repos r JOIN project_challenges pc ON pc.repo_id=r.id WHERE pc.challenge_id=c.id AND r.is_test_account=$2) AS "expectedCount",
 (SELECT count(DISTINCT r.id)::int FROM repos r JOIN project_challenges pc ON pc.repo_id=r.id WHERE pc.challenge_id=c.id AND r.submission_status='submitted' AND r.is_test_account=$2) AS "projectCount",
 (SELECT count(DISTINCT s.user_id)::int FROM project_challenges pc JOIN submissions s ON s.repo_id=pc.repo_id AND s.status='active' JOIN repos r ON r.id=pc.repo_id WHERE pc.challenge_id=c.id AND r.is_test_account=$2) AS "memberCount"
 FROM challenges c WHERE c.is_test_account=$2 AND ($1::int[] IS NULL OR c.id=ANY($1)) ORDER BY c.id`,
    [challengeIds === "all" ? null : challengeIds, fixtureMarker],
  );
  return rows;
}

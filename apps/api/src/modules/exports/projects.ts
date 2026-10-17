import type { TemplateField } from "@hackos/shared/forms";
import { config } from "../../config.js";
import { withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { csvCell, toCsv } from "../../lib/csv.js";

/** H16/H54: export the configured form, with submitted answers tied to their immutable version. */
export async function exportProjectsCsv(actorId: number): Promise<string> {
  return withTransaction(async (db) => {
    const current = await db.query(
      `SELECT template FROM project_form_versions ORDER BY id DESC LIMIT 1`,
    );
    const currentTemplate: TemplateField[] = current.rows[0]?.template ?? [];
    const { rows } = await db.query(`SELECT r.*,v.snapshot,f.template AS submitted_template,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('name',u.name,'surname',u.surname,'email',u.email,'school',uni.name) ORDER BY (u.id=r.created_by) DESC,s.created_at,u.id)
        FROM submissions s JOIN users u ON u.id=s.user_id LEFT JOIN universities uni ON uni.id=u.university_id
        WHERE s.repo_id=r.id AND s.status='active' AND u.account_state='active' AND u.anonymized_at IS NULL AND NOT u.is_test_account),'[]') AS members,
      COALESCE((SELECT string_agg(c.title, '; ' ORDER BY c.id) FROM project_challenges pc JOIN challenges c ON c.id=pc.challenge_id WHERE pc.repo_id=r.id),'') AS challenges,
      CASE
        WHEN EXISTS(SELECT 1 FROM queue_entries q WHERE q.repo_id=r.id) AND NOT EXISTS(SELECT 1 FROM queue_entries q WHERE q.repo_id=r.id AND q.status NOT IN ('completed','disqualified')) THEN 'Finished'
        WHEN EXISTS(SELECT 1 FROM queue_entries q WHERE q.repo_id=r.id AND q.status IN ('completed','in_room','presenting')) THEN 'In progress'
        ELSE 'Pending' END AS judging_status
      FROM repos r LEFT JOIN LATERAL (SELECT snapshot,form_version_id FROM project_submission_versions WHERE repo_id=r.id ORDER BY id DESC LIMIT 1) v ON true
      LEFT JOIN project_form_versions f ON f.id=v.form_version_id
      WHERE NOT r.is_test_account ORDER BY r.id`);
    const maximum = Math.max(0, ...rows.map((row) => row.members.length - 1));
    const questions = new Map(currentTemplate.map((field) => [field.key, field]));
    for (const row of rows)
      for (const field of (row.submitted_template ?? []) as TemplateField[]) {
        if (!questions.has(field.key)) questions.set(field.key, field);
      }
    const header = [
      "Project Name",
      "Submission URL",
      "Submission Status",
      "Judging Status",
      "Created At",
      "Description",
      "GitHub URL",
      "Demo URL",
      "Challenges",
      ...Array.from(questions.values(), (field) => field.label.en || field.label.es || field.key),
      "Submitter First Name",
      "Submitter Last Name",
      "Submitter Email",
      "Team Schools",
      "Additional Team Member Count",
    ];
    for (let i = 1; i <= maximum; i++)
      header.push(
        `Team Member ${i} First Name`,
        `Team Member ${i} Last Name`,
        `Team Member ${i} Email`,
      );
    const safe = (value: unknown): string => {
      const text =
        value != null && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
      return /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
    };
    const data = rows.map((row) => {
      const submitted = row.submission_status === "submitted";
      const project = submitted ? (row.snapshot?.project ?? row) : row;
      const template: TemplateField[] = submitted
        ? (row.submitted_template ?? [])
        : currentTemplate;
      const responses = project.responses ?? {};
      const [submitter, ...members] = row.members;
      const answers = Array.from(questions.keys(), (key) => {
        const field = template.find((candidate) => candidate.key === key);
        if (!field) return "";
        const value = responses[key];
        const choice = (item: unknown) =>
          field.options?.find((option) => option.value === item)?.label.en ?? item;
        return Array.isArray(value) ? value.map(choice).join("; ") : choice(value);
      });
      const cells = [
        project.name,
        new URL(`/gallery/${row.id}`, config.WEB_URL).toString(),
        row.submission_status,
        row.judging_status,
        row.created_at.toISOString(),
        project.description,
        project.github_url,
        project.demo_url,
        row.challenges,
        ...answers,
        submitter?.name,
        submitter?.surname,
        submitter?.email,
        row.members
          .map((member: { school: string }) => member.school)
          .filter(Boolean)
          .join("; "),
        members.length,
      ];
      for (let i = 0; i < maximum; i++)
        cells.push(members[i]?.name, members[i]?.surname, members[i]?.email);
      return cells.map(safe);
    });
    await audit(db, {
      actorId,
      entityType: "project_export",
      entityId: "all",
      action: "export",
      after: { count: rows.length },
    });
    return toCsv(
      header.map((label) => csvCell(safe(label))),
      data,
    );
  });
}

-- 1002_content_reports_edition.sql — content reports belong to an edition.
--
-- DELTA(H18): content_reports had no event_key; listReports derived the
-- edition from the reporter's diary entry (people) or the repo (projects), so
-- deleting the diary entry hid an open report and a reporter who saved the
-- same person in two editions showed it in both. The edition is now stored on
-- the report, like the other edition-owned tables of 1001 (H8): defaulted from
-- current_edition(), guarded against writes into a closed edition.
--
-- Backfill: project reports take their repo's edition; person reports take the
-- edition of the reporter's diary entry about that person (the edition the
-- report was filed in, preferring the current one), else the current edition.
ALTER TABLE public.content_reports
  ADD COLUMN event_key text REFERENCES public.editions(event_key) ON UPDATE CASCADE;

UPDATE public.content_reports r
   SET event_key = repo.event_key
  FROM public.repos repo
 WHERE r.repo_id = repo.id;

UPDATE public.content_reports r
   SET event_key = COALESCE(
         (SELECT d.event_key FROM public.diary_entries d
           WHERE d.owner_id = r.reporter_id AND d.target_user_id = r.target_user_id
           ORDER BY (d.event_key = COALESCE((SELECT event_key FROM public.event_config WHERE id = 1), 'default')) DESC,
                    d.created_at DESC
           LIMIT 1),
         COALESCE((SELECT event_key FROM public.event_config WHERE id = 1), 'default'))
 WHERE r.target_user_id IS NOT NULL;

ALTER TABLE public.content_reports
  ALTER COLUMN event_key SET NOT NULL,
  ALTER COLUMN event_key SET DEFAULT public.current_edition();
CREATE INDEX content_reports_event_key ON public.content_reports (event_key);

-- One open report per reporter, target and edition.
DROP INDEX public.content_reports_open_person;
CREATE UNIQUE INDEX content_reports_open_person
  ON public.content_reports (reporter_id, target_user_id, event_key)
  WHERE target_user_id IS NOT NULL AND status = 'open';

CREATE TRIGGER content_reports_edition_inherit BEFORE INSERT ON public.content_reports
  FOR EACH ROW WHEN (NEW.repo_id IS NOT NULL)
  EXECUTE FUNCTION public.edition_inherit_from_parent('repos', 'repo_id');
CREATE TRIGGER content_reports_edition_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.content_reports
  FOR EACH ROW EXECUTE FUNCTION public.edition_write_guard();

COMMENT ON COLUMN public.content_reports.event_key IS 'H18/H8: edition the report was filed in; project reports inherit their repo''s edition.';

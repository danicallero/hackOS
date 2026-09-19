-- 0001_hackos_baseline.sql — consolidated pre-production starting schema.
--
-- Scope: final relational model for H1–H59, rebuilt from a clean application
-- database after the retired development ledger was applied and verified against
-- schema.dbml. This migration contains schema and required system defaults only:
-- no staging users, applications, projects, operational logs or migration ledger.
--
-- Reading guide:
--   1. Extensions, enum domains and shared trigger functions.
--   2. Tables are labelled by product domain in PostgreSQL's dependency-safe
--      creation order; foreign keys, indexes and triggers follow afterwards.
--   3. Required singleton/default-role seeds at the end.
--
-- This is the new root of the migration lineage. Never use it to upgrade a
-- database carrying the retired ledger: recreate that staging database first.

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: unaccent; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;


--
-- Name: EXTENSION unaccent; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';


--
-- Name: app_response_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_response_status AS ENUM (
    'draft',
    'review',
    'accepted',
    'confirmed',
    'declined',
    'rejected',
    'expired',
    'accepted_internal',
    'rejected_internal'
);


--
-- Name: notification_channel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_channel AS ENUM (
    'in_app',
    'email',
    'discord',
    'push'
);


--
-- Name: permission_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.permission_state AS ENUM (
    'allow',
    'deny',
    'inherit'
);


--
-- Name: queue_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.queue_status AS ENUM (
    'waiting',
    'called',
    'in_room',
    'presenting',
    'completed',
    'returned_to_queue',
    'no_show',
    'skipped',
    'cancelled',
    'disqualified'
);


--
-- Name: token_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.token_type AS ENUM (
    'primary_email',
    'secondary_email',
    'account_claim',
    'password_reset',
    'sponsor_invite',
    'spot_confirmation'
);


--
-- Name: challenge_default_queue_group(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.challenge_default_queue_group() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  new_group integer;
BEGIN
  INSERT INTO queue_groups (enterprise_id, display_name)
  SELECT s.enterprise_id, NEW.title
    FROM sponsors s
   WHERE s.id = NEW.author
  RETURNING id INTO new_group;

  INSERT INTO queue_group_challenges (queue_group_id, challenge_id)
  VALUES (new_group, NEW.id);

  RETURN NULL;
END;
$$;


--
-- Name: h54_capture_user_email_history(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.h54_capture_user_email_history() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  address text;
BEGIN
  FOREACH address IN ARRAY ARRAY[OLD.email, OLD.secondary_email, NEW.email, NEW.secondary_email]
  LOOP
    IF NULLIF(btrim(address), '') IS NOT NULL THEN
      INSERT INTO user_email_history (user_id, email)
      VALUES (NEW.id, lower(btrim(address)))
      ON CONFLICT (user_id, email) DO NOTHING;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;


--
-- Name: h54_prevent_form_version_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.h54_prevent_form_version_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'application form versions are immutable'
    USING ERRCODE = '55006';
END;
$$;


--
-- Name: h54_require_active_user_reference(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.h54_require_active_user_reference() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  referenced_user_id bigint;
  old_referenced_user_id bigint;
  cutoff timestamptz;
  removal_started_at_value timestamptz;
  latest_id bigint;
  latest_kind text;
BEGIN
  referenced_user_id := NULLIF(to_jsonb(NEW)->>TG_ARGV[0], '')::bigint;
  -- Detaching an identity is always safe.  In particular, ON DELETE SET NULL
  -- and the removal scrub deliberately clear references while the old user is
  -- already `removal_pending`; do not make that cleanup depend on the old row
  -- still passing the active-account gate.
  IF referenced_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_referenced_user_id := NULLIF(to_jsonb(OLD)->>TG_ARGV[0], '')::bigint;
    -- Never transfer a row from a pending identity to another identity.  A
    -- NULL destination is allowed for the removal scrub below.
    IF old_referenced_user_id IS NOT NULL
       AND old_referenced_user_id IS DISTINCT FROM referenced_user_id THEN
      PERFORM 1
        FROM users
       WHERE id = old_referenced_user_id
         AND account_state = 'active'
         AND anonymized_at IS NULL
       FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'user account is closed or being removed'
          USING ERRCODE = '23514',
                HINT = 'Retry after reloading the current account state';
      END IF;
    END IF;
  END IF;

  -- The only identity-bearing write permitted after removal starts is the
  -- exit row for the already-open venue session.  It must retain the same
  -- user_id on UPDATE and is serialized by the user-row lock.
  IF TG_TABLE_NAME = 'time_logs'
     AND TG_ARGV[0] = 'user_id'
     AND to_jsonb(NEW)->>'kind' = 'out'
     AND (TG_OP <> 'UPDATE' OR old_referenced_user_id IS NOT DISTINCT FROM referenced_user_id) THEN
    cutoff := NULLIF(to_jsonb(NEW)->>'scanned_at', '')::timestamptz;
    SELECT id, kind
      INTO latest_id, latest_kind
      FROM time_logs
     WHERE user_id = referenced_user_id
       AND kind IN ('in', 'out')
       AND scanned_at <= cutoff
     ORDER BY scanned_at DESC, id DESC
     LIMIT 1;
    SELECT removal_started_at
      INTO removal_started_at_value
      FROM users
     WHERE id = referenced_user_id
       AND account_state = 'removal_pending'
       AND removal_requires_exit = true
       AND anonymized_at IS NULL
     FOR SHARE;
    IF FOUND
       AND latest_kind = 'in'
       AND (TG_OP <> 'UPDATE' OR latest_id = NULLIF(to_jsonb(NEW)->>'id', '')::bigint)
       AND removal_started_at_value IS NOT NULL
       AND (
         cutoff >= removal_started_at_value
         OR (
           TG_OP = 'INSERT'
           AND to_jsonb(NEW)->>'scanned_by' IS NULL
           AND to_jsonb(NEW)->>'notes' = 'Automatic exit at event end'
           AND EXISTS (
             SELECT 1
               FROM event_config
              WHERE id = 1
                AND event_ends_at = cutoff
                AND event_ends_at <= clock_timestamp()
           )
         )
       ) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Recovery sign-in and session refresh remain available during a reversible
  -- exit, but a session must never outlive the already-captured deadline.
  IF TG_TABLE_NAME = 'sessions'
     AND TG_ARGV[0] = 'user_id'
     AND (TG_OP <> 'UPDATE' OR old_referenced_user_id IS NOT DISTINCT FROM referenced_user_id)
     AND NULLIF(to_jsonb(NEW)->>'expires_at', '')::timestamptz <= (
       SELECT removal_expires_at
         FROM users
        WHERE id = referenced_user_id
          AND account_state = 'removal_pending'
          AND removal_action = 'anonymize'
          AND removal_requires_exit = true
          AND anonymized_at IS NULL
          AND removal_expires_at IS NOT NULL
          AND removal_expires_at > clock_timestamp()
        FOR SHARE
     ) THEN
    RETURN NEW;
  END IF;

  PERFORM 1
    FROM users
   WHERE id = referenced_user_id
     AND account_state = 'active'
     AND anonymized_at IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user account is closed or being removed'
      USING ERRCODE = '23514',
            HINT = 'Retry after reloading the current account state';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION h54_require_active_user_reference(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.h54_require_active_user_reference() IS 'H54: reject identity-bearing rows for pending/anonymized users; permit only the locked pending exit time log and bounded recovery sessions.';


--
-- Name: h54_set_badge_assigned_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.h54_set_badge_assigned_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.badge_id IS NULL THEN
    NEW.badge_assigned_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.badge_assigned_at := clock_timestamp();
  ELSIF NEW.badge_id IS DISTINCT FROM OLD.badge_id THEN
    NEW.badge_assigned_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: queue_group_enterprise_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_group_enterprise_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  target_group integer;
  offender integer;
BEGIN
  IF TG_TABLE_NAME = 'queue_groups' THEN
    target_group := NEW.id;
  ELSE
    target_group := NEW.queue_group_id;
  END IF;

  SELECT qgc.challenge_id INTO offender
    FROM queue_group_challenges qgc
    JOIN queue_groups qg ON qg.id = qgc.queue_group_id
    JOIN challenges c ON c.id = qgc.challenge_id
    JOIN sponsors s ON s.id = c.author
   WHERE qgc.queue_group_id = target_group
     AND s.enterprise_id IS DISTINCT FROM qg.enterprise_id
   LIMIT 1;

  IF offender IS NOT NULL THEN
    RAISE EXCEPTION
      'queue_group % cannot contain challenge %: it belongs to a different enterprise',
      target_group, offender
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: room_queue_group_enterprise_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.room_queue_group_enterprise_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  pooled_enterprise integer;
  group_enterprise integer;
BEGIN
  SELECT enterprise_id INTO pooled_enterprise
    FROM room_enterprises WHERE room_id = NEW.room_id;

  SELECT enterprise_id INTO group_enterprise
    FROM queue_groups WHERE id = NEW.queue_group_id;

  IF pooled_enterprise IS DISTINCT FROM group_enterprise THEN
    RAISE EXCEPTION
      'room % cannot serve queue_group %: it is pooled into a different enterprise',
      NEW.room_id, NEW.queue_group_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--

-- ── Privacy, auditing, idempotency and reporting ───────────────────────────────────────────────
-- Name: account_removal_pin_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_removal_pin_challenges (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    email text NOT NULL,
    pin_digest text NOT NULL,
    nonce text NOT NULL,
    attempts smallint DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT account_removal_pin_challenges_attempts_check CHECK (((attempts >= 0) AND (attempts <= 5)))
);


--
-- Name: TABLE account_removal_pin_challenges; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.account_removal_pin_challenges IS 'H54 transient one-time verified-email removal PIN state; deleted with the user.';


--
-- Name: COLUMN account_removal_pin_challenges.pin_digest; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account_removal_pin_challenges.pin_digest IS 'HMAC digest of the six-digit PIN, user id, email, and nonce; raw PINs are never persisted.';


--
-- Name: account_removal_pin_challenges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.account_removal_pin_challenges ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.account_removal_pin_challenges_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Identity, authentication and authorization ───────────────────────────────────────────────
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id integer NOT NULL,
    user_id integer NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    password text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.accounts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Event operations, attendance and wallet ───────────────────────────────────────────────
-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    id integer NOT NULL,
    name text NOT NULL,
    description text,
    category text DEFAULT 'general'::text NOT NULL,
    requires_scan boolean DEFAULT false NOT NULL,
    color text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    schedule_id integer,
    primary_language text DEFAULT 'es'::text NOT NULL,
    name_i18n jsonb,
    description_i18n jsonb,
    CONSTRAINT activities_primary_language_check CHECK ((primary_language = ANY (ARRAY['es'::text, 'gl'::text, 'en'::text])))
);


--
-- Name: activities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.activities ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.activities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_logs (
    id integer NOT NULL,
    user_id integer NOT NULL,
    activity_id integer NOT NULL,
    notes text,
    logged_at timestamp with time zone DEFAULT now() NOT NULL,
    logged_by integer,
    source_device_id text,
    source_scan_id text
);


--
-- Name: activity_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.activity_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.activity_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Content and notifications ───────────────────────────────────────────────
-- Name: announcement_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcement_reads (
    announcement_id integer NOT NULL,
    user_id integer NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: announcement_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcement_recipients (
    announcement_id integer NOT NULL,
    user_id integer NOT NULL
);


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id integer NOT NULL,
    author_id integer,
    title text NOT NULL,
    body text NOT NULL,
    publish_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    fanned_out_at timestamp with time zone,
    notify_users boolean DEFAULT false NOT NULL,
    screen_placement text DEFAULT 'none'::text NOT NULL,
    translations jsonb DEFAULT '{}'::jsonb NOT NULL,
    audiences text[] DEFAULT '{}'::text[] NOT NULL,
    channels text[] DEFAULT '{in_app,email,push}'::text[] NOT NULL,
    CONSTRAINT announcements_channels_valid CHECK (((channels <@ ARRAY['in_app'::text, 'email'::text, 'push'::text]) AND (array_length(channels, 1) > 0))),
    CONSTRAINT announcements_screen_placement_check CHECK ((screen_placement = ANY (ARRAY['none'::text, 'embedded'::text, 'fullscreen'::text]))),
    CONSTRAINT announcements_translations_object_check CHECK ((jsonb_typeof(translations) = 'object'::text))
);


--
-- Name: announcements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.announcements ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.announcements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Privacy, auditing, idempotency and reporting ───────────────────────────────────────────────
-- Name: anonymous_participant_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.anonymous_participant_fields (
    id bigint NOT NULL,
    anonymous_participant_id uuid NOT NULL,
    application_id integer,
    application_form_version integer,
    field_key text NOT NULL,
    anonymous_audit_dimension text,
    field_kind text NOT NULL,
    value jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT anonymous_participant_fields_application_form_version_check CHECK (((application_form_version IS NULL) OR (application_form_version > 0))),
    CONSTRAINT anonymous_participant_fields_field_key_check CHECK ((btrim(field_key) <> ''::text)),
    CONSTRAINT anonymous_participant_fields_field_kind_check CHECK ((btrim(field_kind) <> ''::text))
);


--
-- Name: TABLE anonymous_participant_fields; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.anonymous_participant_fields IS 'H54 permanent anonymous answers explicitly marked ANONYMOUS_AUDIT in the submitted form snapshot.';


--
-- Name: COLUMN anonymous_participant_fields.application_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.anonymous_participant_fields.application_id IS 'Form context only; it is not application_responses.id and does not identify the participant.';


--
-- Name: COLUMN anonymous_participant_fields.value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.anonymous_participant_fields.value IS 'Sanitized typed value copied only when the submitted field definition opts into anonymous audit.';


--
-- Name: anonymous_participant_fields_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.anonymous_participant_fields ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.anonymous_participant_fields_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: anonymous_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.anonymous_participants (
    id uuid NOT NULL,
    guaranteed_presence_minutes integer DEFAULT 0 NOT NULL,
    is_test_account boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT anonymous_participants_guaranteed_presence_minutes_check CHECK ((guaranteed_presence_minutes >= 0))
);


--
-- Name: TABLE anonymous_participants; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.anonymous_participants IS 'H54 permanent anonymous audit subject. id is random and unrelated to users.id.';


--
-- Name: COLUMN anonymous_participants.guaranteed_presence_minutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.anonymous_participants.guaranteed_presence_minutes IS 'H24 verified venue time rounded down to complete minutes; raw presence rows are not retained.';


--
-- Name: COLUMN anonymous_participants.is_test_account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.anonymous_participants.is_test_account IS 'Synthetic fixture marker; marked anonymous subjects are excluded from normal statistics.';


--

-- ── Applications and review ───────────────────────────────────────────────
-- Name: applicant_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.applicant_reviews (
    response_id integer NOT NULL,
    author_id integer NOT NULL,
    score integer,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT applicant_reviews_score_check CHECK (((score >= 0) AND (score <= 5)))
);


--
-- Name: application_form_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_form_versions (
    id bigint NOT NULL,
    application_id integer NOT NULL,
    version integer NOT NULL,
    template jsonb NOT NULL,
    sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT application_form_versions_version_check CHECK ((version > 0))
);


--
-- Name: TABLE application_form_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.application_form_versions IS 'H54 immutable form-definition snapshots; response retention uses the submitted snapshot.';


--
-- Name: COLUMN application_form_versions.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.application_form_versions.created_by IS 'Administrator who published the snapshot; nullable so removing that actor leaves no identity bridge.';


--
-- Name: application_form_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.application_form_versions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.application_form_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: application_grants_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_grants_roles (
    application_id integer NOT NULL,
    role_id integer NOT NULL
);


--
-- Name: TABLE application_grants_roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.application_grants_roles IS 'H8/H11: roles granted to the applicant on confirmation, in addition to ticket issuance. No rows for a form grants nothing.';


--
-- Name: application_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_responses (
    id integer NOT NULL,
    user_id integer NOT NULL,
    application_id integer NOT NULL,
    referrer_user_id integer,
    referrer_application_id integer,
    status public.app_response_status DEFAULT 'draft'::public.app_response_status NOT NULL,
    responses jsonb DEFAULT '{}'::jsonb NOT NULL,
    staff_notes text,
    confirmation_token_id integer,
    confirmed_at timestamp with time zone,
    declined_at timestamp with time zone,
    decision_sent_at timestamp with time zone,
    submitted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    application_form_version_id bigint NOT NULL
);


--
-- Name: application_responses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.application_responses ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.application_responses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.applications (
    id integer NOT NULL,
    name text NOT NULL,
    template jsonb NOT NULL,
    description text,
    open_at timestamp with time zone,
    close_at timestamp with time zone,
    capacity integer,
    confirmation_window_hours integer DEFAULT 168 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ask_shirt_size boolean DEFAULT false NOT NULL,
    ask_food_intolerances boolean DEFAULT false NOT NULL,
    sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    current_form_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT applications_current_form_version_check CHECK ((current_form_version > 0))
);


--
-- Name: applications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.applications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.applications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Projects, submissions and judging queue ───────────────────────────────────────────────
-- Name: attempt_review; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attempt_review (
    attempt_id integer NOT NULL,
    scores jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attempt_review_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text])))
);


--
-- Name: attempt_review_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attempt_review_versions (
    id integer NOT NULL,
    attempt_id integer NOT NULL,
    author_id integer,
    changed_fields text[] NOT NULL,
    previous jsonb,
    new jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: attempt_review_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.attempt_review_versions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.attempt_review_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Privacy, auditing, idempotency and reporting ───────────────────────────────────────────────
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    actor_id integer,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    action text NOT NULL,
    source text,
    before jsonb,
    after jsonb,
    reason text,
    ip text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Identity, authentication and authorization ───────────────────────────────────────────────
-- Name: capability_grant_quarantine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capability_grant_quarantine (
    id integer NOT NULL,
    group_id integer NOT NULL,
    capability text NOT NULL,
    reason text NOT NULL,
    quarantined_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE capability_grant_quarantine; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.capability_grant_quarantine IS 'H8/H53 repair queue for grants outside packages/shared/src/capabilities.ts; these grants never participate in authorization.';


--
-- Name: capability_grant_quarantine_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.capability_grant_quarantine ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.capability_grant_quarantine_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Sponsors, enterprises and challenges ───────────────────────────────────────────────
-- Name: challenge_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenge_versions (
    id integer NOT NULL,
    challenge_id integer NOT NULL,
    editor_id integer,
    snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: challenge_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.challenge_versions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.challenge_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: challenge_winners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenge_winners (
    id integer NOT NULL,
    challenge_id integer NOT NULL,
    rank smallint NOT NULL,
    repo_id integer NOT NULL,
    set_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT challenge_winners_rank_check CHECK ((rank >= 1))
);


--
-- Name: challenge_winners_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.challenge_winners ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.challenge_winners_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenges (
    id integer NOT NULL,
    author integer NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    criteria text,
    judging_panel_criteria jsonb,
    prizes jsonb,
    devpost_tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    max_presentation_seconds integer,
    auto_call_count integer DEFAULT 3 NOT NULL,
    visibility text DEFAULT 'hidden'::text NOT NULL,
    available_from timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    title_i18n jsonb,
    criteria_i18n jsonb,
    description_i18n jsonb,
    max_in_waiting_area integer DEFAULT 2 NOT NULL,
    is_test_account boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN challenges.is_test_account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.challenges.is_test_account IS 'Synthetic review-fixture queue marker; ordinary event operations exclude marked rows.';


--
-- Name: challenges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.challenges ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.challenges_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Event operations, attendance and wallet ───────────────────────────────────────────────
-- Name: check_in_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.check_in_logs (
    id integer NOT NULL,
    user_id integer,
    badge_id text,
    checked_in_at timestamp with time zone DEFAULT now() NOT NULL,
    check_in_method text DEFAULT 'manual'::text NOT NULL,
    staff_id integer,
    notes text
);


--
-- Name: check_in_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.check_in_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.check_in_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Privacy, auditing, idempotency and reporting ───────────────────────────────────────────────
-- Name: data_subject_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_subject_requests (
    id integer NOT NULL,
    subject_user_id integer,
    requested_by integer,
    type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reason text,
    storage_key text,
    error text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT data_subject_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]))),
    CONSTRAINT data_subject_requests_type_check CHECK ((type = ANY (ARRAY['export'::text, 'deletion'::text])))
);


--
-- Name: data_subject_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.data_subject_requests ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.data_subject_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Projects, submissions and judging queue ───────────────────────────────────────────────
-- Name: devpost_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devpost_participants (
    repo_id integer NOT NULL,
    email text NOT NULL,
    name text,
    surname text,
    devpost_username text,
    user_id integer,
    import_batch text NOT NULL,
    merge_status text DEFAULT 'unmatched'::text NOT NULL,
    linked_by integer,
    linked_at timestamp with time zone,
    claim_email_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: devpost_prizes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devpost_prizes (
    name text NOT NULL,
    last_batch text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- ── Identity, authentication and authorization ───────────────────────────────────────────────
-- Name: email_verification_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_verification_tokens (
    id integer NOT NULL,
    token text NOT NULL,
    type public.token_type NOT NULL,
    email text NOT NULL,
    user_id integer,
    enterprise_id integer,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text,
    role_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
    wildcard_authorized boolean DEFAULT false NOT NULL,
    CONSTRAINT email_verification_tokens_kind_check CHECK (((kind IS NULL) OR (kind = ANY (ARRAY['staff'::text, 'sponsor'::text, 'participant'::text]))))
);


--
-- Name: COLUMN email_verification_tokens.role_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.email_verification_tokens.role_ids IS 'H8/H10: role ids (roles.id) pre-assigned on invite acceptance via user_roles.';


--
-- Name: COLUMN email_verification_tokens.wildcard_authorized; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.email_verification_tokens.wildcard_authorized IS 'Durable proof that a wildcard holder authorized this deferred group grant.';


--
-- Name: email_verification_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.email_verification_tokens ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.email_verification_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: enterprise_invite_link_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enterprise_invite_link_redemptions (
    id integer NOT NULL,
    link_id integer NOT NULL,
    user_id integer,
    email text NOT NULL,
    name text,
    redeemed_at timestamp with time zone DEFAULT now() NOT NULL,
    redeemed_ip inet,
    redeemed_user_agent text
);


--
-- Name: enterprise_invite_link_redemptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.enterprise_invite_link_redemptions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.enterprise_invite_link_redemptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: enterprise_invite_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enterprise_invite_links (
    id integer NOT NULL,
    token text NOT NULL,
    enterprise_id integer NOT NULL,
    created_by integer,
    max_redeems integer,
    redeemed_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT enterprise_invite_links_max_redeems_check CHECK (((max_redeems IS NULL) OR (max_redeems > 0))),
    CONSTRAINT enterprise_invite_links_redeemed_count_check CHECK ((redeemed_count >= 0))
);


--
-- Name: enterprise_invite_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.enterprise_invite_links ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.enterprise_invite_links_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Projects, submissions and judging queue ───────────────────────────────────────────────
-- Name: enterprise_judges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enterprise_judges (
    enterprise_id integer NOT NULL,
    user_id integer NOT NULL,
    added_by integer,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- ── Sponsors, enterprises and challenges ───────────────────────────────────────────────
-- Name: enterprises; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enterprises (
    id integer NOT NULL,
    name text NOT NULL,
    logo_url text,
    website text,
    director_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    description text,
    visibility text DEFAULT 'hidden'::text NOT NULL,
    available_from timestamp with time zone,
    priority integer,
    logo_negative_url text,
    CONSTRAINT enterprises_priority_check CHECK (((priority IS NULL) OR (priority > 0))),
    CONSTRAINT enterprises_visibility_check CHECK ((visibility = ANY (ARRAY['visible'::text, 'hidden'::text])))
);


--
-- Name: enterprises_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.enterprises ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.enterprises_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Event operations, attendance and wallet ───────────────────────────────────────────────
-- Name: event_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_config (
    id integer NOT NULL,
    name text,
    tagline text,
    timezone text DEFAULT 'Europe/Madrid'::text NOT NULL,
    hacking_starts_at timestamp with time zone,
    hacking_ends_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    show_start_countdown boolean DEFAULT false NOT NULL,
    venue_name text,
    venue_latitude double precision,
    venue_longitude double precision,
    pass_back_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    pass_field_labels jsonb DEFAULT '{}'::jsonb NOT NULL,
    event_starts_at timestamp with time zone,
    pass_field_visibility jsonb DEFAULT '{}'::jsonb NOT NULL,
    event_ends_at timestamp with time zone,
    wifi_ssid text,
    wifi_password text,
    tv_language text,
    require_sponsor_shirt_size boolean DEFAULT false NOT NULL,
    require_sponsor_dietary boolean DEFAULT false NOT NULL,
    require_staff_shirt_size boolean DEFAULT false NOT NULL,
    require_staff_dietary boolean DEFAULT false NOT NULL,
    shirt_sizes text[] DEFAULT '{XS,S,M,L,XL,XXL}'::text[] NOT NULL,
    participants_can_create_projects boolean DEFAULT false NOT NULL,
    presence_auto_entry_at timestamp with time zone,
    presence_certainty_window_minutes integer DEFAULT 720 NOT NULL,
    CONSTRAINT event_config_check CHECK (((hacking_starts_at IS NULL) OR (hacking_ends_at IS NULL) OR (hacking_ends_at > hacking_starts_at))),
    CONSTRAINT event_config_event_window CHECK (((event_starts_at IS NULL) OR (event_ends_at IS NULL) OR (event_ends_at > event_starts_at))),
    CONSTRAINT event_config_id_check CHECK ((id = 1)),
    CONSTRAINT event_config_presence_window_positive CHECK (((presence_certainty_window_minutes >= 15) AND (presence_certainty_window_minutes <= 10080))),
    CONSTRAINT event_config_tv_language_check CHECK ((tv_language = ANY (ARRAY['es'::text, 'gl'::text, 'en'::text]))),
    CONSTRAINT event_config_venue_coords_paired CHECK (((venue_latitude IS NULL) = (venue_longitude IS NULL)))
);


--
-- Name: food_intolerances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.food_intolerances (
    id integer NOT NULL,
    label jsonb NOT NULL,
    description jsonb,
    proposed_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: food_intolerances_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.food_intolerances ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.food_intolerances_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Privacy, auditing, idempotency and reporting ───────────────────────────────────────────────
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_keys (
    key text NOT NULL,
    scope text NOT NULL,
    request_hash text NOT NULL,
    response_status integer,
    response_body jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--

-- ── Projects, submissions and judging queue ───────────────────────────────────────────────
-- Name: judging_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.judging_session (
    id integer NOT NULL,
    judge_id integer,
    queue_entry_id integer NOT NULL,
    room_id integer,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    submitted_at timestamp with time zone,
    ended_at timestamp with time zone
);


--
-- Name: judging_session_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.judging_session ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.judging_session_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Event operations, attendance and wallet ───────────────────────────────────────────────
-- Name: meal_scan_batch_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meal_scan_batch_items (
    id integer NOT NULL,
    batch_id integer NOT NULL,
    activity_id integer NOT NULL,
    device_id text NOT NULL,
    client_scan_id text NOT NULL,
    badge_id text,
    allow_repeat boolean DEFAULT false NOT NULL,
    scanned_at timestamp with time zone,
    status text DEFAULT 'pending'::text NOT NULL,
    result jsonb,
    error jsonb,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: COLUMN meal_scan_batch_items.badge_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meal_scan_batch_items.badge_id IS 'H54 transient retry credential; NULL after terminal processing and never part of audit history.';


--
-- Name: meal_scan_batch_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.meal_scan_batch_items ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.meal_scan_batch_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: meal_scan_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meal_scan_batches (
    id integer NOT NULL,
    activity_id integer NOT NULL,
    device_id text NOT NULL,
    submitted_by integer,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_test_account boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN meal_scan_batches.is_test_account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meal_scan_batches.is_test_account IS 'H54 fixture marker captured at enqueue; remains stable if submitted_by is scrubbed.';


--
-- Name: meal_scan_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.meal_scan_batches ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.meal_scan_batches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Content and notifications ───────────────────────────────────────────────
-- Name: notification_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_outbox (
    id integer NOT NULL,
    user_id integer NOT NULL,
    category text NOT NULL,
    channel public.notification_channel NOT NULL,
    payload jsonb,
    status text DEFAULT 'queued'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    next_attempt_at timestamp with time zone DEFAULT now(),
    sent_at timestamp with time zone,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.notification_outbox ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.notification_outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id integer NOT NULL,
    category text NOT NULL,
    channel public.notification_channel NOT NULL,
    enabled boolean DEFAULT true NOT NULL
);


--
-- Name: push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_tokens (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token text NOT NULL,
    platform text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: push_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.push_tokens ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.push_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Projects, submissions and judging queue ───────────────────────────────────────────────
-- Name: queue_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.queue_entries (
    id integer NOT NULL,
    challenge_id integer NOT NULL,
    repo_id integer NOT NULL,
    assigned_room_id integer,
    status public.queue_status DEFAULT 'waiting'::public.queue_status NOT NULL,
    "position" integer,
    priority integer DEFAULT 0 NOT NULL,
    call_count integer DEFAULT 0 NOT NULL,
    called_at timestamp with time zone,
    presentation_started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    precalled_at timestamp with time zone
);


--
-- Name: queue_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.queue_entries ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.queue_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: queue_group_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.queue_group_challenges (
    queue_group_id integer NOT NULL,
    challenge_id integer NOT NULL
);


--
-- Name: queue_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.queue_groups (
    id integer NOT NULL,
    enterprise_id integer NOT NULL,
    display_name text NOT NULL,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    judging_panel_criteria jsonb
);


--
-- Name: COLUMN queue_groups.judging_panel_criteria; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.queue_groups.judging_panel_criteria IS 'Merged judging form for a shared queue (H46): the de-duplicated union of the member challenges'' judging_panel_criteria, admin-reviewed. NULL = resolve the member challenge''s own criteria (every 1:1 group).';


--
-- Name: queue_groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.queue_groups ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.queue_groups_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: queue_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.queue_history (
    id integer NOT NULL,
    queue_entry_id integer NOT NULL,
    actor_id integer,
    previous_status text NOT NULL,
    new_status text NOT NULL,
    action text NOT NULL,
    reason text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: queue_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.queue_history ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.queue_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: queue_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.queue_settings (
    id integer NOT NULL,
    handoff_buffer_minutes integer DEFAULT 5 NOT NULL,
    schedule_start_at timestamp with time zone,
    schedule_end_at timestamp with time zone,
    pre_call_notification_eta_minutes integer DEFAULT 10 NOT NULL,
    requeue_prompt_default text DEFAULT 'ask'::text NOT NULL,
    called_too_long_threshold_minutes integer DEFAULT 10 NOT NULL,
    CONSTRAINT queue_settings_called_too_long_threshold_minutes_check CHECK ((called_too_long_threshold_minutes > 0)),
    CONSTRAINT queue_settings_id_check CHECK ((id = 1))
);


--
-- Name: repo_devpost_prizes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repo_devpost_prizes (
    repo_id integer NOT NULL,
    prize text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: repos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repos (
    id integer NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    github_url text,
    devpost_url text,
    demo_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'devpost'::text NOT NULL,
    created_by integer,
    is_test_account boolean DEFAULT false NOT NULL,
    CONSTRAINT repos_source_check CHECK ((source = ANY (ARRAY['devpost'::text, 'native'::text])))
);


--
-- Name: TABLE repos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.repos IS 'A project/team. Deliberately independent from application_responses — registration teams and submission teams need not match.';


--
-- Name: COLUMN repos.is_test_account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.is_test_account IS 'Synthetic review-fixture project marker; ordinary event operations exclude marked rows.';


--
-- Name: repos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.repos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.repos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Privacy, auditing, idempotency and reporting ───────────────────────────────────────────────
-- Name: review_fixture_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_fixture_accounts (
    fixture_key text NOT NULL,
    user_id integer,
    generation integer DEFAULT 0 NOT NULL,
    last_authenticated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    last_authenticated_ip text,
    CONSTRAINT review_fixture_accounts_fixture_key_check CHECK ((btrim(fixture_key) <> ''::text)),
    CONSTRAINT review_fixture_accounts_generation_check CHECK ((generation >= 0))
);


--
-- Name: TABLE review_fixture_accounts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.review_fixture_accounts IS 'Current synthetic reviewer account pointers; never use as an anonymous identity mapping.';


--
-- Name: COLUMN review_fixture_accounts.last_authenticated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.review_fixture_accounts.last_authenticated_at IS 'Last synthetic fixture sign-in signal; no credential or participant response is stored.';


--
-- Name: COLUMN review_fixture_accounts.last_authenticated_ip; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.review_fixture_accounts.last_authenticated_ip IS 'Most recent trusted request IP for a successful synthetic fixture sign-in; no failed-attempt or user-agent history is stored.';


--
-- Name: review_fixture_queues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_fixture_queues (
    fixture_key text NOT NULL,
    enterprise_id integer,
    sponsor_id integer,
    challenge_id integer,
    repo_id integer,
    queue_entry_id integer,
    generation integer NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT review_fixture_queues_generation_check CHECK ((generation > 0))
);


--
-- Name: TABLE review_fixture_queues; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.review_fixture_queues IS 'Current synthetic queue/project pointers; never use as a participant-to-anonymous mapping.';


--

-- ── Identity, authentication and authorization ───────────────────────────────────────────────
-- Name: role_capabilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_capabilities (
    role_id integer NOT NULL,
    capability text NOT NULL,
    state public.permission_state DEFAULT 'inherit'::public.permission_state NOT NULL,
    CONSTRAINT role_capabilities_known_catalogue CHECK ((capability = ANY (ARRAY['*'::text, 'users:read'::text, 'users:write'::text, 'permissions:manage'::text, 'invites:manage'::text, 'applications:manage'::text, 'applications:review'::text, 'applications:decide'::text, 'applications:confirm-override'::text, 'applications:edit-response'::text, 'statistics:manage'::text, 'projects:read'::text, 'projects:import'::text, 'projects:edit'::text, 'accredit:scan'::text, 'presence:scan'::text, 'activity:scan'::text, 'logistics:stats'::text, 'intolerances:manage'::text, 'queue:status'::text, 'queue:operate'::text, 'queue:admin'::text, 'judge:panel'::text, 'judging:export'::text, 'sponsors:manage'::text, 'challenges:manage'::text, 'schedule:manage'::text, 'announcements:manage'::text, 'tv:control'::text, 'notifications:send'::text, 'audit:read'::text, 'exports:run'::text, 'event:manage'::text, 'venue:manage'::text, 'wallet:manage'::text, 'presence:manage'::text])))
);


--
-- Name: role_grant_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_grant_rules (
    id integer NOT NULL,
    role_id integer NOT NULL,
    trigger_event text,
    action text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    enterprise_id integer,
    source_role_id integer,
    CONSTRAINT role_grant_rules_action_check CHECK ((action = ANY (ARRAY['grant'::text, 'revoke'::text]))),
    CONSTRAINT role_grant_rules_source_role_not_self CHECK (((source_role_id IS NULL) OR (source_role_id <> role_id))),
    CONSTRAINT role_grant_rules_trigger_xor_source_role CHECK ((((trigger_event IS NOT NULL) AND (source_role_id IS NULL)) OR ((trigger_event IS NULL) AND (source_role_id IS NOT NULL))))
);


--
-- Name: TABLE role_grant_rules; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.role_grant_rules IS 'H8: admin-configurable automatic role grant/revoke rules keyed off a fixed developer-defined trigger_event vocabulary (packages/shared/src/role-grant-triggers.ts). enterprise_id NULL scopes a rule to every occurrence of trigger_event; a specific enterprise_id scopes it to that one enterprise only, and can coexist with a global rule for the same event.';


--
-- Name: COLUMN role_grant_rules.source_role_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.role_grant_rules.source_role_id IS 'H8: alternative to trigger_event — a rule fires when THIS role is assigned (action=grant) or removed (action=revoke) from a user, instead of on a domain trigger_event. Exactly one of the two columns is set. See identity/role-grants.ts applyRoleAssignmentGrantRules/applyRoleAssignmentRevokeRules.';


--
-- Name: role_grant_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.role_grant_rules ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.role_grant_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: role_seed_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_seed_defaults (
    role_id integer NOT NULL,
    capabilities jsonb NOT NULL,
    event_access boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE role_seed_defaults; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.role_seed_defaults IS 'H8: one row per is_seeded role, capturing exactly the ALLOW capability set it was seeded with (0801 Sponsor, 0805 default catalogue). Used by GET /api/roles/:roleId/seed-diff and POST /api/roles/:roleId/reset-to-default to compute/undo drift from live role_capabilities.';


--
-- Name: COLUMN role_seed_defaults.event_access; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.role_seed_defaults.event_access IS 'H8: seed-time event entitlement for the role, restored together with its seed-time capability snapshot.';


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    name text NOT NULL,
    "position" integer NOT NULL,
    is_visible boolean DEFAULT true NOT NULL,
    is_protected boolean DEFAULT false NOT NULL,
    is_seeded boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    event_access boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.roles IS 'H8: the authorization truth. is_visible marks a role eligible to be shown as a user''s public role; is_protected is the enforced (not informational) lockout — every HTTP mutation route refuses a role with is_protected = true outright (role-authority.ts assertNotProtectedRole), regardless of the actor''s own capabilities; it is never settable via POST/PATCH /api/roles, only by direct DB/CLI action (only system:superadmin carries it today, see scripts/grant-superadmin.mjs and create-superadmin.ts); is_seeded marks a role that came from a seed migration rather than being created by an admin.';


--
-- Name: COLUMN roles.is_protected; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.roles.is_protected IS 'H8: the real, enforced lockout — every HTTP mutation route (rename/reorder/capability-edit/delete/restore/assign/unassign) refuses a role with is_protected = true outright, unconditional on the actor''s own capabilities (role-authority.ts assertNotProtectedRole). Never settable via POST/PATCH /api/roles; only ever flipped by direct DB/CLI action. Only system:superadmin carries it as of this migration (0801''s "Platform administrator" template row was corrected to false — every default role stays deletable/editable like any other role), but any future role given this flag gets the identical lockout automatically.';


--
-- Name: COLUMN roles.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.roles.deleted_at IS 'H8: soft-delete marker. Non-null excludes the role from capability resolution (user_effective_capabilities), from default GET /api/roles listings, and from every "highest role" / wildcard-holder computation, as if the user held no such role. A deleted role''s position becomes available for reuse (see roles_position_idx below); POST .../restore 409s only if a still-live role has since taken that exact slot.';


--
-- Name: COLUMN roles.event_access; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.roles.event_access IS 'H8/H15: whether holding this role entitles a user to use the event app and receive an entrance ticket. Independent of is_visible and role capabilities; effective access is OR across assigned, non-deleted roles.';


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.roles ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Projects, submissions and judging queue ───────────────────────────────────────────────
-- Name: room_enterprises; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_enterprises (
    room_id integer NOT NULL,
    enterprise_id integer NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by integer
);


--
-- Name: room_queue_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_queue_groups (
    room_id integer NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by integer,
    queue_group_id integer NOT NULL
);


--
-- Name: room_queue_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_queue_state (
    room_id integer NOT NULL,
    is_paused boolean DEFAULT true NOT NULL,
    max_in_waiting_area integer DEFAULT 2 NOT NULL,
    desired_minutes_per_team integer DEFAULT 8 NOT NULL,
    started_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rooms (
    id integer NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    location text,
    status text DEFAULT 'paused'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rooms_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.rooms ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.rooms_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Privacy, auditing, idempotency and reporting ───────────────────────────────────────────────
-- Name: scanner_revoked_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scanner_revoked_badges (
    credential_digest text NOT NULL,
    revoked_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT scanner_revoked_badges_credential_digest_check CHECK ((credential_digest ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: TABLE scanner_revoked_badges; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.scanner_revoked_badges IS 'H54 unlinked keyed-digest denylist for permanently retired badge credentials; raw badges are never retained.';


--
-- Name: COLUMN scanner_revoked_badges.credential_digest; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scanner_revoked_badges.credential_digest IS 'HMAC-SHA256 of a retired badge credential under the deployment secret.';


--
-- Name: scanner_revoked_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scanner_revoked_tickets (
    credential_digest text NOT NULL,
    revoked_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT scanner_revoked_tickets_credential_digest_check CHECK ((credential_digest ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: TABLE scanner_revoked_tickets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.scanner_revoked_tickets IS 'H54 unlinked keyed-digest denylist for permanently retired ticket credentials; raw tokens are never retained.';


--
-- Name: COLUMN scanner_revoked_tickets.credential_digest; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scanner_revoked_tickets.credential_digest IS 'HMAC-SHA256 of a retired ticket credential under the deployment secret.';


--

-- ── Content and notifications ───────────────────────────────────────────────
-- Name: schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule (
    id integer NOT NULL,
    title text NOT NULL,
    description text,
    location text,
    type text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    visibility text DEFAULT 'hidden'::text NOT NULL,
    publish_at timestamp with time zone,
    reminded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    requires_scan boolean DEFAULT false NOT NULL,
    audiences text[] DEFAULT '{}'::text[] NOT NULL,
    contact_note text,
    notes text,
    primary_language text DEFAULT 'es'::text NOT NULL,
    title_i18n jsonb,
    description_i18n jsonb,
    CONSTRAINT schedule_audiences_valid CHECK ((audiences <@ ARRAY['sponsor'::text, 'participant'::text, 'mentor'::text])),
    CONSTRAINT schedule_primary_language_check CHECK ((primary_language = ANY (ARRAY['es'::text, 'gl'::text, 'en'::text]))),
    CONSTRAINT schedule_visibility_requires_audience CHECK (((COALESCE(array_length(audiences, 1), 0) > 0) OR ((visibility = 'hidden'::text) AND (publish_at IS NULL))))
);


--
-- Name: schedule_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.schedule ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.schedule_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: schedule_owners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_owners (
    id integer NOT NULL,
    schedule_id integer NOT NULL,
    user_id integer,
    assigned_by integer,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    free_text_name text,
    CONSTRAINT schedule_owners_exactly_one_identity CHECK ((((user_id IS NOT NULL) AND (free_text_name IS NULL)) OR ((user_id IS NULL) AND (free_text_name IS NOT NULL))))
);


--
-- Name: schedule_owners_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.schedule_owners ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.schedule_owners_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Identity, authentication and authorization ───────────────────────────────────────────────
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.sessions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Sponsors, enterprises and challenges ───────────────────────────────────────────────
-- Name: sponsor_faq; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sponsor_faq (
    id integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT sponsor_faq_id_check CHECK ((id = 1))
);


--
-- Name: sponsors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sponsors (
    id integer NOT NULL,
    enterprise_id integer NOT NULL,
    user_id integer,
    joined_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sponsors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.sponsors ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sponsors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Privacy, auditing, idempotency and reporting ───────────────────────────────────────────────
-- Name: statistics_scope_panel_role_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.statistics_scope_panel_role_access (
    scope_key text NOT NULL,
    panel_key text NOT NULL,
    role_id integer NOT NULL,
    state public.permission_state DEFAULT 'inherit'::public.permission_state NOT NULL,
    CONSTRAINT statistics_scope_panel_role_access_panel_key_check CHECK ((panel_key ~ '^[a-z0-9:_-]+$'::text)),
    CONSTRAINT statistics_scope_panel_role_access_scope_key_check CHECK ((scope_key ~ '^[a-z][a-z0-9_-]*:[0-9]+$'::text))
);


--
-- Name: TABLE statistics_scope_panel_role_access; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.statistics_scope_panel_role_access IS 'H27: generic scope/panel ACL resolved by the existing role-position tri-state chain.';


--

-- ── Projects, submissions and judging queue ───────────────────────────────────────────────
-- Name: submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.submissions (
    repo_id integer NOT NULL,
    user_id integer NOT NULL,
    imported_from text DEFAULT 'manual'::text NOT NULL,
    external_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    invited_by integer,
    responded_at timestamp with time zone,
    CONSTRAINT submissions_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text])))
);


--

-- ── Event operations, attendance and wallet ───────────────────────────────────────────────
-- Name: tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tickets (
    user_id integer NOT NULL,
    token text NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: time_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_logs (
    id integer NOT NULL,
    user_id integer,
    kind text NOT NULL,
    scanned_at timestamp with time zone DEFAULT now() NOT NULL,
    scanned_by integer,
    notes text,
    CONSTRAINT time_logs_kind_check CHECK ((kind = ANY (ARRAY['in'::text, 'out'::text])))
);


--
-- Name: time_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.time_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.time_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tv_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tv_slots (
    id bigint NOT NULL,
    label text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    items jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tv_slots_items_not_empty CHECK ((jsonb_array_length(items) > 0)),
    CONSTRAINT tv_slots_window_ordered CHECK ((ends_at > starts_at))
);


--
-- Name: tv_slots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tv_slots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tv_slots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tv_slots_id_seq OWNED BY public.tv_slots.id;


--
-- Name: universities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.universities (
    id integer NOT NULL,
    name text NOT NULL,
    proposed_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    suggested_by integer
);


--
-- Name: COLUMN universities.suggested_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.universities.suggested_by IS 'H12: authenticated self-service proposer. Unlike proposed_by (which records every creator, including staff), a person may have at most one active suggestion.';


--
-- Name: universities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.universities ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.universities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Identity, authentication and authorization ───────────────────────────────────────────────
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    user_id integer NOT NULL,
    role_id integer NOT NULL,
    assigned_by integer,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL
);


--
-- Name: user_effective_capabilities; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.user_effective_capabilities AS
 SELECT user_id,
    capability
   FROM ( SELECT DISTINCT ON (ur.user_id, rc.capability) ur.user_id,
            rc.capability,
            rc.state
           FROM ((public.user_roles ur
             JOIN public.roles r ON ((r.id = ur.role_id)))
             JOIN public.role_capabilities rc ON ((rc.role_id = r.id)))
          WHERE ((rc.state <> 'inherit'::public.permission_state) AND (r.deleted_at IS NULL))
          ORDER BY ur.user_id, rc.capability, r."position" DESC) resolved
  WHERE (state = 'allow'::public.permission_state);


--
-- Name: VIEW user_effective_capabilities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.user_effective_capabilities IS 'H8: (user_id, capability) pairs currently resolving to ALLOW through the user''s own assigned-role chain. Replaces the old recursive group_capabilities join everywhere a bulk per-user capability check is needed.';


--
-- Name: user_effective_role_name; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.user_effective_role_name AS
 SELECT DISTINCT ON (ur.user_id) ur.user_id,
    r.name AS role_name
   FROM (public.user_roles ur
     JOIN public.roles r ON ((r.id = ur.role_id)))
  WHERE ((r.is_visible = true) AND (r.deleted_at IS NULL))
  ORDER BY ur.user_id, r."position" DESC;


--
-- Name: VIEW user_effective_role_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.user_effective_role_name IS 'H8: each user''s single highest-position visible role name. No row means the user holds no visible role. Bulk equivalent of identity/role.ts''s getEffectiveRole/getHighestVisibleRoleName.';


--
-- Name: user_email_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_email_history (
    user_id integer NOT NULL,
    email text NOT NULL,
    recorded_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT user_email_history_email_check CHECK ((btrim(email) <> ''::text))
);


--
-- Name: TABLE user_email_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_email_history IS 'H54 transient cleanup aid. It is deleted with the owning user and never copied to anonymous data.';


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email text NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    image text,
    name text,
    surname text,
    dni text,
    badge_id text,
    badge_id_history text[] DEFAULT '{}'::text[] NOT NULL,
    food_intolerances integer[] DEFAULT '{}'::integer[] NOT NULL,
    food_intolerance_notes text,
    university_id integer,
    shirt_size text,
    language text DEFAULT 'en'::text NOT NULL,
    secondary_email text,
    secondary_email_verified_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    anonymized_at timestamp with time zone,
    dietary_data_state text DEFAULT 'not_provided'::text NOT NULL,
    ui_prefs jsonb DEFAULT '{}'::jsonb NOT NULL,
    account_state text DEFAULT 'active'::text NOT NULL,
    removal_action text,
    removal_started_at timestamp with time zone,
    removal_requires_exit boolean DEFAULT false NOT NULL,
    removal_idempotency_key text,
    removal_expires_at timestamp with time zone,
    is_test_account boolean DEFAULT false NOT NULL,
    badge_assigned_at timestamp with time zone,
    CONSTRAINT users_account_state_check CHECK ((account_state = ANY (ARRAY['active'::text, 'removal_pending'::text]))),
    CONSTRAINT users_badge_assignment_timestamp_check CHECK (((badge_id IS NULL) = (badge_assigned_at IS NULL))),
    CONSTRAINT users_dietary_data_state_check CHECK ((dietary_data_state = ANY (ARRAY['not_provided'::text, 'present'::text]))),
    CONSTRAINT users_removal_action_check CHECK (((removal_action IS NULL) OR (removal_action = ANY (ARRAY['delete'::text, 'anonymize'::text]))))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.users IS 'Authorization is resolved from the user''s assigned roles and each role''s tri-state capability grants (H8). Display labels may be relationship-derived, but never authorize access.';


--
-- Name: COLUMN users.account_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.account_state IS 'H54 lifecycle gate: identity-bearing writers are rejected after removal_pending commits.';


--
-- Name: COLUMN users.removal_action; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.removal_action IS 'H54 action selected while the user row is locked; retries cannot change the mode.';


--
-- Name: COLUMN users.removal_requires_exit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.removal_requires_exit IS 'H54 pending-exit gate: only a valid current-badge or event-end exit may be recorded.';


--
-- Name: COLUMN users.removal_idempotency_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.removal_idempotency_key IS 'H54 transient self-service replay key; it is deleted with the user and is not an identity map.';


--
-- Name: COLUMN users.removal_expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.removal_expires_at IS 'H54 fixed pending-exit recovery deadline; later sign-ins cannot extend it.';


--
-- Name: COLUMN users.is_test_account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.is_test_account IS 'Synthetic reviewer/QA fixture marker; ordinary event surfaces exclude marked rows.';


--
-- Name: COLUMN users.badge_assigned_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.badge_assigned_at IS 'H23/H54 current physical badge assignment boundary for stale offline scan rejection.';


--
-- Name: user_event_access; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.user_event_access AS
 SELECT DISTINCT ur.user_id
   FROM ((public.user_roles ur
     JOIN public.roles r ON ((r.id = ur.role_id)))
     JOIN public.users u ON ((u.id = ur.user_id)))
  WHERE ((u.account_state = 'active'::text) AND (u.anonymized_at IS NULL) AND (r.event_access = true) AND (r.deleted_at IS NULL));


--
-- Name: VIEW user_event_access; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.user_event_access IS 'H8: canonical event-access projection. A user is admitted only when active, non-anonymized, and assigned at least one non-deleted role with event_access=true. Access is an OR across qualifying roles and is independent of visibility/capabilities.';


--
-- Name: user_invite_link_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_invite_link_redemptions (
    id integer NOT NULL,
    link_id integer NOT NULL,
    user_id integer,
    email text NOT NULL,
    name text,
    redeemed_at timestamp with time zone DEFAULT now() NOT NULL,
    redeemed_ip inet,
    redeemed_user_agent text
);


--
-- Name: user_invite_link_redemptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.user_invite_link_redemptions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_invite_link_redemptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_invite_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_invite_links (
    id integer NOT NULL,
    token text NOT NULL,
    kind text NOT NULL,
    enterprise_id integer,
    created_by integer,
    role_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
    wildcard_authorized boolean DEFAULT false NOT NULL,
    max_redeems integer,
    redeemed_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_invite_links_check CHECK ((((kind = 'sponsor'::text) AND (enterprise_id IS NOT NULL)) OR ((kind <> 'sponsor'::text) AND (enterprise_id IS NULL)))),
    CONSTRAINT user_invite_links_kind_check CHECK ((kind = ANY (ARRAY['staff'::text, 'sponsor'::text, 'participant'::text]))),
    CONSTRAINT user_invite_links_max_redeems_check CHECK (((max_redeems IS NULL) OR (max_redeems > 0))),
    CONSTRAINT user_invite_links_redeemed_count_check CHECK ((redeemed_count >= 0))
);


--
-- Name: COLUMN user_invite_links.role_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_invite_links.role_ids IS 'H8/H10: role ids (roles.id) pre-assigned on link redemption via user_roles.';


--
-- Name: COLUMN user_invite_links.wildcard_authorized; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_invite_links.wildcard_authorized IS 'Durable proof that a wildcard holder authorized this deferred group grant.';


--
-- Name: user_invite_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.user_invite_links ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_invite_links_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verifications (
    id integer NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.verifications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.verifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--

-- ── Event operations, attendance and wallet ───────────────────────────────────────────────
-- Name: wallet_access_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_access_tokens (
    id integer NOT NULL,
    token text NOT NULL,
    user_id integer NOT NULL,
    purpose text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wallet_access_tokens_purpose_check CHECK ((purpose = ANY (ARRAY['ticket'::text, 'badge'::text])))
);


--
-- Name: wallet_access_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.wallet_access_tokens ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.wallet_access_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: wallet_pass_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_pass_devices (
    pass_id integer NOT NULL,
    device_library_identifier text NOT NULL,
    push_token text,
    registered_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wallet_passes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_passes (
    id integer NOT NULL,
    user_id integer NOT NULL,
    purpose text NOT NULL,
    platform text NOT NULL,
    serial_number text NOT NULL,
    authentication_token text NOT NULL,
    google_object_id text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    update_tag text DEFAULT (((EXTRACT(epoch FROM now()) * (1000)::numeric))::bigint)::text NOT NULL,
    google_object_type text,
    CONSTRAINT wallet_passes_google_object_type_check CHECK (((google_object_type IS NULL) OR (google_object_type = ANY (ARRAY['generic'::text, 'event_ticket'::text]))))
);


--
-- Name: COLUMN wallet_passes.google_object_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.wallet_passes.google_object_type IS 'H28: Google Wallet resource type. Existing GenericObject rows are retained as legacy; new tickets use event_ticket and badges use generic.';


--
-- Name: wallet_passes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.wallet_passes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.wallet_passes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tv_slots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tv_slots ALTER COLUMN id SET DEFAULT nextval('public.tv_slots_id_seq'::regclass);


--
-- Name: account_removal_pin_challenges account_removal_pin_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_removal_pin_challenges
    ADD CONSTRAINT account_removal_pin_challenges_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_provider_id_account_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_provider_id_account_id_key UNIQUE (provider_id, account_id);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


--
-- Name: activities activities_schedule_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_schedule_id_key UNIQUE (schedule_id);


--
-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


--
-- Name: announcement_reads announcement_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_reads
    ADD CONSTRAINT announcement_reads_pkey PRIMARY KEY (announcement_id, user_id);


--
-- Name: announcement_recipients announcement_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_recipients
    ADD CONSTRAINT announcement_recipients_pkey PRIMARY KEY (announcement_id, user_id);


--
-- Name: announcements announcements_no_expiry_when_notify_only; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.announcements
    ADD CONSTRAINT announcements_no_expiry_when_notify_only CHECK (((screen_placement <> 'none'::text) OR (notify_users = false) OR (expires_at IS NULL))) NOT VALID;


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: announcements announcements_visibility_window_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.announcements
    ADD CONSTRAINT announcements_visibility_window_check CHECK (((expires_at IS NULL) OR (publish_at IS NULL) OR (expires_at > publish_at))) NOT VALID;


--
-- Name: anonymous_participant_fields anonymous_participant_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anonymous_participant_fields
    ADD CONSTRAINT anonymous_participant_fields_pkey PRIMARY KEY (id);


--
-- Name: anonymous_participants anonymous_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anonymous_participants
    ADD CONSTRAINT anonymous_participants_pkey PRIMARY KEY (id);


--
-- Name: applicant_reviews applicant_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applicant_reviews
    ADD CONSTRAINT applicant_reviews_pkey PRIMARY KEY (response_id, author_id);


--
-- Name: application_form_versions application_form_versions_application_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_form_versions
    ADD CONSTRAINT application_form_versions_application_id_id_key UNIQUE (application_id, id);


--
-- Name: application_form_versions application_form_versions_application_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_form_versions
    ADD CONSTRAINT application_form_versions_application_id_version_key UNIQUE (application_id, version);


--
-- Name: application_form_versions application_form_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_form_versions
    ADD CONSTRAINT application_form_versions_pkey PRIMARY KEY (id);


--
-- Name: application_grants_roles application_grants_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_grants_roles
    ADD CONSTRAINT application_grants_roles_pkey PRIMARY KEY (application_id, role_id);


--
-- Name: application_responses application_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_responses
    ADD CONSTRAINT application_responses_pkey PRIMARY KEY (id);


--
-- Name: application_responses application_responses_user_id_application_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_responses
    ADD CONSTRAINT application_responses_user_id_application_id_key UNIQUE (user_id, application_id);


--
-- Name: applications applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_pkey PRIMARY KEY (id);


--
-- Name: attempt_review attempt_review_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attempt_review
    ADD CONSTRAINT attempt_review_pkey PRIMARY KEY (attempt_id);


--
-- Name: attempt_review_versions attempt_review_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attempt_review_versions
    ADD CONSTRAINT attempt_review_versions_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: capability_grant_quarantine capability_grant_quarantine_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capability_grant_quarantine
    ADD CONSTRAINT capability_grant_quarantine_pkey PRIMARY KEY (id);


--
-- Name: challenge_versions challenge_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_versions
    ADD CONSTRAINT challenge_versions_pkey PRIMARY KEY (id);


--
-- Name: challenge_winners challenge_winners_challenge_id_rank_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_winners
    ADD CONSTRAINT challenge_winners_challenge_id_rank_key UNIQUE (challenge_id, rank);


--
-- Name: challenge_winners challenge_winners_challenge_id_repo_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_winners
    ADD CONSTRAINT challenge_winners_challenge_id_repo_id_key UNIQUE (challenge_id, repo_id);


--
-- Name: challenge_winners challenge_winners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_winners
    ADD CONSTRAINT challenge_winners_pkey PRIMARY KEY (id);


--
-- Name: challenges challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenges
    ADD CONSTRAINT challenges_pkey PRIMARY KEY (id);


--
-- Name: check_in_logs check_in_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_in_logs
    ADD CONSTRAINT check_in_logs_pkey PRIMARY KEY (id);


--
-- Name: data_subject_requests data_subject_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_subject_requests
    ADD CONSTRAINT data_subject_requests_pkey PRIMARY KEY (id);


--
-- Name: devpost_participants devpost_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devpost_participants
    ADD CONSTRAINT devpost_participants_pkey PRIMARY KEY (repo_id, email);


--
-- Name: devpost_prizes devpost_prizes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devpost_prizes
    ADD CONSTRAINT devpost_prizes_pkey PRIMARY KEY (name);


--
-- Name: email_verification_tokens email_verification_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_pkey PRIMARY KEY (id);


--
-- Name: email_verification_tokens email_verification_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_token_key UNIQUE (token);


--
-- Name: enterprise_invite_link_redemptions enterprise_invite_link_redemptions_link_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprise_invite_link_redemptions
    ADD CONSTRAINT enterprise_invite_link_redemptions_link_id_user_id_key UNIQUE (link_id, user_id);


--
-- Name: enterprise_invite_link_redemptions enterprise_invite_link_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprise_invite_link_redemptions
    ADD CONSTRAINT enterprise_invite_link_redemptions_pkey PRIMARY KEY (id);


--
-- Name: enterprise_invite_links enterprise_invite_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprise_invite_links
    ADD CONSTRAINT enterprise_invite_links_pkey PRIMARY KEY (id);


--
-- Name: enterprise_invite_links enterprise_invite_links_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprise_invite_links
    ADD CONSTRAINT enterprise_invite_links_token_key UNIQUE (token);


--
-- Name: enterprise_judges enterprise_judges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprise_judges
    ADD CONSTRAINT enterprise_judges_pkey PRIMARY KEY (enterprise_id, user_id);


--
-- Name: enterprises enterprises_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprises
    ADD CONSTRAINT enterprises_name_key UNIQUE (name);


--
-- Name: enterprises enterprises_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprises
    ADD CONSTRAINT enterprises_pkey PRIMARY KEY (id);


--
-- Name: event_config event_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_config
    ADD CONSTRAINT event_config_pkey PRIMARY KEY (id);


--
-- Name: food_intolerances food_intolerances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_intolerances
    ADD CONSTRAINT food_intolerances_pkey PRIMARY KEY (id);


--
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (key, scope);


--
-- Name: judging_session judging_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.judging_session
    ADD CONSTRAINT judging_session_pkey PRIMARY KEY (id);


--
-- Name: meal_scan_batch_items meal_scan_batch_items_device_id_client_scan_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meal_scan_batch_items
    ADD CONSTRAINT meal_scan_batch_items_device_id_client_scan_id_key UNIQUE (device_id, client_scan_id);


--
-- Name: meal_scan_batch_items meal_scan_batch_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meal_scan_batch_items
    ADD CONSTRAINT meal_scan_batch_items_pkey PRIMARY KEY (id);


--
-- Name: meal_scan_batches meal_scan_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meal_scan_batches
    ADD CONSTRAINT meal_scan_batches_pkey PRIMARY KEY (id);


--
-- Name: notification_outbox notification_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id, category, channel);


--
-- Name: push_tokens push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (id);


--
-- Name: push_tokens push_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_token_key UNIQUE (token);


--
-- Name: queue_entries queue_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_pkey PRIMARY KEY (id);


--
-- Name: queue_group_challenges queue_group_challenges_challenge_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_group_challenges
    ADD CONSTRAINT queue_group_challenges_challenge_id_key UNIQUE (challenge_id);


--
-- Name: queue_group_challenges queue_group_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_group_challenges
    ADD CONSTRAINT queue_group_challenges_pkey PRIMARY KEY (queue_group_id, challenge_id);


--
-- Name: queue_groups queue_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_groups
    ADD CONSTRAINT queue_groups_pkey PRIMARY KEY (id);


--
-- Name: queue_history queue_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_history
    ADD CONSTRAINT queue_history_pkey PRIMARY KEY (id);


--
-- Name: queue_settings queue_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_settings
    ADD CONSTRAINT queue_settings_pkey PRIMARY KEY (id);


--
-- Name: repo_devpost_prizes repo_devpost_prizes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repo_devpost_prizes
    ADD CONSTRAINT repo_devpost_prizes_pkey PRIMARY KEY (repo_id, prize);


--
-- Name: repos repos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repos
    ADD CONSTRAINT repos_pkey PRIMARY KEY (id);


--
-- Name: review_fixture_accounts review_fixture_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_fixture_accounts
    ADD CONSTRAINT review_fixture_accounts_pkey PRIMARY KEY (fixture_key);


--
-- Name: review_fixture_accounts review_fixture_accounts_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_fixture_accounts
    ADD CONSTRAINT review_fixture_accounts_user_id_key UNIQUE (user_id);


--
-- Name: review_fixture_queues review_fixture_queues_challenge_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_fixture_queues
    ADD CONSTRAINT review_fixture_queues_challenge_id_key UNIQUE (challenge_id);


--
-- Name: review_fixture_queues review_fixture_queues_enterprise_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_fixture_queues
    ADD CONSTRAINT review_fixture_queues_enterprise_id_key UNIQUE (enterprise_id);


--
-- Name: review_fixture_queues review_fixture_queues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_fixture_queues
    ADD CONSTRAINT review_fixture_queues_pkey PRIMARY KEY (fixture_key);


--
-- Name: review_fixture_queues review_fixture_queues_queue_entry_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_fixture_queues
    ADD CONSTRAINT review_fixture_queues_queue_entry_id_key UNIQUE (queue_entry_id);


--
-- Name: review_fixture_queues review_fixture_queues_repo_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_fixture_queues
    ADD CONSTRAINT review_fixture_queues_repo_id_key UNIQUE (repo_id);


--
-- Name: review_fixture_queues review_fixture_queues_sponsor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_fixture_queues
    ADD CONSTRAINT review_fixture_queues_sponsor_id_key UNIQUE (sponsor_id);


--
-- Name: role_capabilities role_capabilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_capabilities
    ADD CONSTRAINT role_capabilities_pkey PRIMARY KEY (role_id, capability);


--
-- Name: role_grant_rules role_grant_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_grant_rules
    ADD CONSTRAINT role_grant_rules_pkey PRIMARY KEY (id);


--
-- Name: role_seed_defaults role_seed_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_seed_defaults
    ADD CONSTRAINT role_seed_defaults_pkey PRIMARY KEY (role_id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: room_enterprises room_enterprises_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_enterprises
    ADD CONSTRAINT room_enterprises_pkey PRIMARY KEY (room_id);


--
-- Name: room_queue_groups room_queue_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_queue_groups
    ADD CONSTRAINT room_queue_groups_pkey PRIMARY KEY (room_id, queue_group_id);


--
-- Name: room_queue_groups room_queue_groups_room_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_queue_groups
    ADD CONSTRAINT room_queue_groups_room_id_unique UNIQUE (room_id);


--
-- Name: room_queue_state room_queue_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_queue_state
    ADD CONSTRAINT room_queue_state_pkey PRIMARY KEY (room_id);


--
-- Name: rooms rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);


--
-- Name: rooms rooms_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_slug_key UNIQUE (slug);


--
-- Name: scanner_revoked_badges scanner_revoked_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scanner_revoked_badges
    ADD CONSTRAINT scanner_revoked_badges_pkey PRIMARY KEY (credential_digest);


--
-- Name: scanner_revoked_tickets scanner_revoked_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scanner_revoked_tickets
    ADD CONSTRAINT scanner_revoked_tickets_pkey PRIMARY KEY (credential_digest);


--
-- Name: schedule_owners schedule_owners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_owners
    ADD CONSTRAINT schedule_owners_pkey PRIMARY KEY (id);


--
-- Name: schedule_owners schedule_owners_schedule_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_owners
    ADD CONSTRAINT schedule_owners_schedule_id_user_id_key UNIQUE (schedule_id, user_id);


--
-- Name: schedule schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule
    ADD CONSTRAINT schedule_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_token_key UNIQUE (token);


--
-- Name: sponsor_faq sponsor_faq_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sponsor_faq
    ADD CONSTRAINT sponsor_faq_pkey PRIMARY KEY (id);


--
-- Name: sponsors sponsors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sponsors
    ADD CONSTRAINT sponsors_pkey PRIMARY KEY (id);


--
-- Name: statistics_scope_panel_role_access statistics_scope_panel_role_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_scope_panel_role_access
    ADD CONSTRAINT statistics_scope_panel_role_access_pkey PRIMARY KEY (scope_key, panel_key, role_id);


--
-- Name: submissions submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_pkey PRIMARY KEY (repo_id, user_id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (user_id);


--
-- Name: tickets tickets_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_token_key UNIQUE (token);


--
-- Name: time_logs time_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_logs
    ADD CONSTRAINT time_logs_pkey PRIMARY KEY (id);


--
-- Name: tv_slots tv_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tv_slots
    ADD CONSTRAINT tv_slots_pkey PRIMARY KEY (id);


--
-- Name: universities universities_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.universities
    ADD CONSTRAINT universities_name_key UNIQUE (name);


--
-- Name: universities universities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.universities
    ADD CONSTRAINT universities_pkey PRIMARY KEY (id);


--
-- Name: user_email_history user_email_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_email_history
    ADD CONSTRAINT user_email_history_pkey PRIMARY KEY (user_id, email);


--
-- Name: user_invite_link_redemptions user_invite_link_redemptions_link_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invite_link_redemptions
    ADD CONSTRAINT user_invite_link_redemptions_link_id_user_id_key UNIQUE (link_id, user_id);


--
-- Name: user_invite_link_redemptions user_invite_link_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invite_link_redemptions
    ADD CONSTRAINT user_invite_link_redemptions_pkey PRIMARY KEY (id);


--
-- Name: user_invite_links user_invite_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invite_links
    ADD CONSTRAINT user_invite_links_pkey PRIMARY KEY (id);


--
-- Name: user_invite_links user_invite_links_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invite_links
    ADD CONSTRAINT user_invite_links_token_key UNIQUE (token);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);


--
-- Name: users users_badge_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_badge_id_key UNIQUE (badge_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: verifications verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verifications
    ADD CONSTRAINT verifications_pkey PRIMARY KEY (id);


--
-- Name: wallet_access_tokens wallet_access_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_access_tokens
    ADD CONSTRAINT wallet_access_tokens_pkey PRIMARY KEY (id);


--
-- Name: wallet_access_tokens wallet_access_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_access_tokens
    ADD CONSTRAINT wallet_access_tokens_token_key UNIQUE (token);


--
-- Name: wallet_pass_devices wallet_pass_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_pass_devices
    ADD CONSTRAINT wallet_pass_devices_pkey PRIMARY KEY (pass_id, device_library_identifier);


--
-- Name: wallet_passes wallet_passes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_passes
    ADD CONSTRAINT wallet_passes_pkey PRIMARY KEY (id);


--
-- Name: account_removal_pin_challenges_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_removal_pin_challenges_user ON public.account_removal_pin_challenges USING btree (user_id, created_at DESC);


--
-- Name: accounts_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounts_user_id ON public.accounts USING btree (user_id);


--
-- Name: activity_logs_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_logs_activity ON public.activity_logs USING btree (activity_id);


--
-- Name: activity_logs_logged_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_logs_logged_by ON public.activity_logs USING btree (logged_by, logged_at DESC);


--
-- Name: activity_logs_source_scan_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX activity_logs_source_scan_unique ON public.activity_logs USING btree (source_device_id, source_scan_id) WHERE ((source_device_id IS NOT NULL) AND (source_scan_id IS NOT NULL));


--
-- Name: activity_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_logs_user ON public.activity_logs USING btree (user_id);


--
-- Name: announcements_publish_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX announcements_publish_at ON public.announcements USING btree (publish_at);


--
-- Name: anonymous_participant_fields_dimension; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX anonymous_participant_fields_dimension ON public.anonymous_participant_fields USING btree (anonymous_audit_dimension) WHERE (anonymous_audit_dimension IS NOT NULL);


--
-- Name: anonymous_participant_fields_form; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX anonymous_participant_fields_form ON public.anonymous_participant_fields USING btree (application_id, application_form_version, field_key);


--
-- Name: anonymous_participant_fields_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX anonymous_participant_fields_subject ON public.anonymous_participant_fields USING btree (anonymous_participant_id);


--
-- Name: anonymous_participants_test_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX anonymous_participants_test_account_idx ON public.anonymous_participants USING btree (id) WHERE (is_test_account = true);


--
-- Name: application_responses_form_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX application_responses_form_version ON public.application_responses USING btree (application_form_version_id);


--
-- Name: attempt_review_versions_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attempt_review_versions_attempt ON public.attempt_review_versions USING btree (attempt_id);


--
-- Name: audit_log_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_actor ON public.audit_log USING btree (actor_id);


--
-- Name: audit_log_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_entity ON public.audit_log USING btree (entity_type, entity_id);


--
-- Name: challenge_versions_challenge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX challenge_versions_challenge ON public.challenge_versions USING btree (challenge_id, created_at);


--
-- Name: challenges_test_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX challenges_test_account_idx ON public.challenges USING btree (id) WHERE (is_test_account = true);


--
-- Name: check_in_logs_staff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX check_in_logs_staff ON public.check_in_logs USING btree (staff_id, checked_in_at DESC);


--
-- Name: data_subject_requests_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX data_subject_requests_one_active ON public.data_subject_requests USING btree (subject_user_id, type) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));


--
-- Name: data_subject_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX data_subject_requests_status ON public.data_subject_requests USING btree (status);


--
-- Name: data_subject_requests_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX data_subject_requests_subject ON public.data_subject_requests USING btree (subject_user_id);


--
-- Name: devpost_participants_merge_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX devpost_participants_merge_status ON public.devpost_participants USING btree (merge_status);


--
-- Name: enterprise_invite_link_redemptions_link_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX enterprise_invite_link_redemptions_link_id ON public.enterprise_invite_link_redemptions USING btree (link_id, redeemed_at DESC);


--
-- Name: enterprise_invite_links_enterprise_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX enterprise_invite_links_enterprise_id ON public.enterprise_invite_links USING btree (enterprise_id, created_at DESC);


--
-- Name: enterprise_judges_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX enterprise_judges_user ON public.enterprise_judges USING btree (user_id);


--
-- Name: judging_session_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX judging_session_active ON public.judging_session USING btree (judge_id, queue_entry_id) WHERE (ended_at IS NULL);


--
-- Name: meal_scan_batch_items_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meal_scan_batch_items_batch ON public.meal_scan_batch_items USING btree (batch_id);


--
-- Name: meal_scan_batch_items_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meal_scan_batch_items_status ON public.meal_scan_batch_items USING btree (status);


--
-- Name: notification_outbox_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_outbox_pending ON public.notification_outbox USING btree (next_attempt_at) WHERE (status = 'queued'::text);


--
-- Name: notification_outbox_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_outbox_user ON public.notification_outbox USING btree (user_id);


--
-- Name: one_active_entry_per_repo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX one_active_entry_per_repo ON public.queue_entries USING btree (repo_id) WHERE (status = ANY (ARRAY['called'::public.queue_status, 'in_room'::public.queue_status, 'presenting'::public.queue_status]));


--
-- Name: one_active_per_room; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX one_active_per_room ON public.queue_entries USING btree (assigned_room_id) WHERE (status = ANY (ARRAY['in_room'::public.queue_status, 'presenting'::public.queue_status]));


--
-- Name: queue_entries_challenge_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_entries_challenge_position ON public.queue_entries USING btree (challenge_id, "position");


--
-- Name: queue_entries_challenge_repo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX queue_entries_challenge_repo ON public.queue_entries USING btree (challenge_id, repo_id);


--
-- Name: queue_entries_challenge_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_entries_challenge_status ON public.queue_entries USING btree (challenge_id, status);


--
-- Name: queue_entries_room_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_entries_room_status ON public.queue_entries USING btree (assigned_room_id, status);


--
-- Name: queue_group_challenges_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_group_challenges_group ON public.queue_group_challenges USING btree (queue_group_id);


--
-- Name: queue_groups_enterprise; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_groups_enterprise ON public.queue_groups USING btree (enterprise_id);


--
-- Name: queue_history_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_history_entry ON public.queue_history USING btree (queue_entry_id);


--
-- Name: repos_devpost_url_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX repos_devpost_url_key ON public.repos USING btree (devpost_url) WHERE (devpost_url IS NOT NULL);


--
-- Name: repos_test_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX repos_test_account_idx ON public.repos USING btree (id) WHERE (is_test_account = true);


--
-- Name: role_grant_rules_source_role_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX role_grant_rules_source_role_id_idx ON public.role_grant_rules USING btree (source_role_id) WHERE enabled;


--
-- Name: role_grant_rules_trigger_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX role_grant_rules_trigger_event_idx ON public.role_grant_rules USING btree (trigger_event) WHERE enabled;


--
-- Name: roles_event_access_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX roles_event_access_idx ON public.roles USING btree (id) WHERE ((event_access = true) AND (deleted_at IS NULL));


--
-- Name: roles_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX roles_position_idx ON public.roles USING btree ("position") WHERE (deleted_at IS NULL);


--
-- Name: room_enterprises_enterprise; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX room_enterprises_enterprise ON public.room_enterprises USING btree (enterprise_id);


--
-- Name: room_queue_groups_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX room_queue_groups_group ON public.room_queue_groups USING btree (queue_group_id);


--
-- Name: schedule_owners_schedule_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schedule_owners_schedule_id_idx ON public.schedule_owners USING btree (schedule_id);


--
-- Name: schedule_pending_publish; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schedule_pending_publish ON public.schedule USING btree (publish_at) WHERE ((visibility = 'hidden'::text) AND (publish_at IS NOT NULL));


--
-- Name: schedule_pending_reminder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schedule_pending_reminder ON public.schedule USING btree (starts_at) WHERE (reminded_at IS NULL);


--
-- Name: sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_id ON public.sessions USING btree (user_id);


--
-- Name: statistics_scope_panel_role_access_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX statistics_scope_panel_role_access_scope_idx ON public.statistics_scope_panel_role_access USING btree (scope_key, panel_key);


--
-- Name: submissions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX submissions_user ON public.submissions USING btree (user_id);


--
-- Name: time_logs_scanned_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_logs_scanned_by ON public.time_logs USING btree (scanned_by, scanned_at DESC);


--
-- Name: time_logs_user_scanned_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_logs_user_scanned_at ON public.time_logs USING btree (user_id, scanned_at DESC, id DESC);


--
-- Name: tv_slots_starts_at_desc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tv_slots_starts_at_desc_idx ON public.tv_slots USING btree (starts_at DESC);


--
-- Name: universities_one_suggestion_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX universities_one_suggestion_per_user ON public.universities USING btree (suggested_by) WHERE (suggested_by IS NOT NULL);


--
-- Name: user_email_history_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_email_history_email ON public.user_email_history USING btree (lower(email));


--
-- Name: user_invite_link_redemptions_link_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_invite_link_redemptions_link_id ON public.user_invite_link_redemptions USING btree (link_id, redeemed_at DESC);


--
-- Name: user_invite_links_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_invite_links_created_at ON public.user_invite_links USING btree (created_at DESC);


--
-- Name: user_roles_role_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_roles_role_id_idx ON public.user_roles USING btree (role_id);


--
-- Name: users_removal_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_removal_expiry ON public.users USING btree (removal_expires_at) WHERE ((account_state = 'removal_pending'::text) AND (removal_expires_at IS NOT NULL));


--
-- Name: users_test_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_test_account_idx ON public.users USING btree (id) WHERE (is_test_account = true);


--
-- Name: users_verified_secondary_email_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_verified_secondary_email_unique ON public.users USING btree (lower(secondary_email)) WHERE (secondary_email_verified_at IS NOT NULL);


--
-- Name: verifications_identifier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX verifications_identifier ON public.verifications USING btree (identifier);


--
-- Name: wallet_access_tokens_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wallet_access_tokens_expires_idx ON public.wallet_access_tokens USING btree (expires_at);


--
-- Name: wallet_passes_one_active_user_purpose_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX wallet_passes_one_active_user_purpose_platform ON public.wallet_passes USING btree (user_id, purpose, platform) WHERE (status <> 'voided'::text);


--
-- Name: accounts accounts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER accounts_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: applicant_reviews applicant_reviews_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER applicant_reviews_updated_at BEFORE UPDATE ON public.applicant_reviews FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: application_responses application_responses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER application_responses_updated_at BEFORE UPDATE ON public.application_responses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: attempt_review attempt_review_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER attempt_review_updated_at BEFORE UPDATE ON public.attempt_review FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: challenge_winners challenge_winners_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER challenge_winners_updated_at BEFORE UPDATE ON public.challenge_winners FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: challenges challenges_default_queue_group; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER challenges_default_queue_group AFTER INSERT ON public.challenges FOR EACH ROW EXECUTE FUNCTION public.challenge_default_queue_group();


--
-- Name: challenges challenges_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER challenges_updated_at BEFORE UPDATE ON public.challenges FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: data_subject_requests data_subject_requests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER data_subject_requests_updated_at BEFORE UPDATE ON public.data_subject_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: devpost_prizes devpost_prizes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER devpost_prizes_updated_at BEFORE UPDATE ON public.devpost_prizes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: enterprise_invite_links enterprise_invite_links_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enterprise_invite_links_updated_at BEFORE UPDATE ON public.enterprise_invite_links FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: event_config event_config_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_config_updated_at BEFORE UPDATE ON public.event_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: audit_log h54_active_user_actor_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_actor_id BEFORE INSERT OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('actor_id');


--
-- Name: queue_history h54_active_user_actor_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_actor_id BEFORE INSERT OR UPDATE ON public.queue_history FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('actor_id');


--
-- Name: enterprise_judges h54_active_user_added_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_added_by BEFORE INSERT OR UPDATE ON public.enterprise_judges FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('added_by');


--
-- Name: room_enterprises h54_active_user_assigned_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_assigned_by BEFORE INSERT OR UPDATE ON public.room_enterprises FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('assigned_by');


--
-- Name: room_queue_groups h54_active_user_assigned_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_assigned_by BEFORE INSERT OR UPDATE ON public.room_queue_groups FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('assigned_by');


--
-- Name: schedule_owners h54_active_user_assigned_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_assigned_by BEFORE INSERT OR UPDATE ON public.schedule_owners FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('assigned_by');


--
-- Name: announcements h54_active_user_author_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_author_id BEFORE INSERT OR UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('author_id');


--
-- Name: applicant_reviews h54_active_user_author_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_author_id BEFORE INSERT OR UPDATE ON public.applicant_reviews FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('author_id');


--
-- Name: attempt_review_versions h54_active_user_author_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_author_id BEFORE INSERT OR UPDATE ON public.attempt_review_versions FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('author_id');


--
-- Name: application_form_versions h54_active_user_created_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_created_by BEFORE INSERT OR UPDATE ON public.application_form_versions FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('created_by');


--
-- Name: enterprise_invite_links h54_active_user_created_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_created_by BEFORE INSERT OR UPDATE ON public.enterprise_invite_links FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('created_by');


--
-- Name: queue_groups h54_active_user_created_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_created_by BEFORE INSERT OR UPDATE ON public.queue_groups FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('created_by');


--
-- Name: repos h54_active_user_created_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_created_by BEFORE INSERT OR UPDATE ON public.repos FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('created_by');


--
-- Name: user_invite_links h54_active_user_created_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_created_by BEFORE INSERT OR UPDATE ON public.user_invite_links FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('created_by');


--
-- Name: enterprises h54_active_user_director_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_director_id BEFORE INSERT OR UPDATE ON public.enterprises FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('director_id');


--
-- Name: challenge_versions h54_active_user_editor_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_editor_id BEFORE INSERT OR UPDATE ON public.challenge_versions FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('editor_id');


--
-- Name: submissions h54_active_user_invited_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_invited_by BEFORE INSERT OR UPDATE ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('invited_by');


--
-- Name: judging_session h54_active_user_judge_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_judge_id BEFORE INSERT OR UPDATE ON public.judging_session FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('judge_id');


--
-- Name: devpost_participants h54_active_user_linked_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_linked_by BEFORE INSERT OR UPDATE ON public.devpost_participants FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('linked_by');


--
-- Name: activity_logs h54_active_user_logged_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_logged_by BEFORE INSERT OR UPDATE ON public.activity_logs FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('logged_by');


--
-- Name: food_intolerances h54_active_user_proposed_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_proposed_by BEFORE INSERT OR UPDATE ON public.food_intolerances FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('proposed_by');


--
-- Name: universities h54_active_user_proposed_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_proposed_by BEFORE INSERT OR UPDATE ON public.universities FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('proposed_by');


--
-- Name: application_responses h54_active_user_referrer_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_referrer_user_id BEFORE INSERT OR UPDATE ON public.application_responses FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('referrer_user_id');


--
-- Name: data_subject_requests h54_active_user_requested_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_requested_by BEFORE INSERT OR UPDATE ON public.data_subject_requests FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('requested_by');


--
-- Name: time_logs h54_active_user_scanned_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_scanned_by BEFORE INSERT OR UPDATE ON public.time_logs FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('scanned_by');


--
-- Name: challenge_winners h54_active_user_set_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_set_by BEFORE INSERT OR UPDATE ON public.challenge_winners FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('set_by');


--
-- Name: check_in_logs h54_active_user_staff_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_staff_id BEFORE INSERT OR UPDATE ON public.check_in_logs FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('staff_id');


--
-- Name: data_subject_requests h54_active_user_subject_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_subject_user_id BEFORE INSERT OR UPDATE ON public.data_subject_requests FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('subject_user_id');


--
-- Name: meal_scan_batches h54_active_user_submitted_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_submitted_by BEFORE INSERT OR UPDATE ON public.meal_scan_batches FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('submitted_by');


--
-- Name: account_removal_pin_challenges h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.account_removal_pin_challenges FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: accounts h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: activity_logs h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.activity_logs FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: announcement_reads h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.announcement_reads FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: announcement_recipients h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.announcement_recipients FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: application_responses h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.application_responses FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: check_in_logs h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.check_in_logs FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: devpost_participants h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.devpost_participants FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: email_verification_tokens h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.email_verification_tokens FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: enterprise_invite_link_redemptions h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.enterprise_invite_link_redemptions FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: enterprise_judges h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.enterprise_judges FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: notification_outbox h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.notification_outbox FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: notification_preferences h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: push_tokens h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.push_tokens FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: review_fixture_accounts h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.review_fixture_accounts FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: schedule_owners h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.schedule_owners FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: sessions h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: sponsors h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.sponsors FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: submissions h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: tickets h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: time_logs h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.time_logs FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: user_email_history h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.user_email_history FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: user_invite_link_redemptions h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.user_invite_link_redemptions FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: wallet_access_tokens h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.wallet_access_tokens FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: wallet_passes h54_active_user_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON public.wallet_passes FOR EACH ROW EXECUTE FUNCTION public.h54_require_active_user_reference('user_id');


--
-- Name: application_form_versions h54_application_form_version_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_application_form_version_immutable BEFORE UPDATE ON public.application_form_versions FOR EACH ROW EXECUTE FUNCTION public.h54_prevent_form_version_update();


--
-- Name: users h54_user_email_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER h54_user_email_history AFTER UPDATE OF email, secondary_email ON public.users FOR EACH ROW EXECUTE FUNCTION public.h54_capture_user_email_history();


--
-- Name: meal_scan_batch_items meal_scan_batch_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER meal_scan_batch_items_updated_at BEFORE UPDATE ON public.meal_scan_batch_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: meal_scan_batches meal_scan_batches_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER meal_scan_batches_updated_at BEFORE UPDATE ON public.meal_scan_batches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: push_tokens push_tokens_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER push_tokens_updated_at BEFORE UPDATE ON public.push_tokens FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: queue_entries queue_entries_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_entries_updated_at BEFORE UPDATE ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: queue_group_challenges queue_group_challenges_enterprise_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER queue_group_challenges_enterprise_guard AFTER INSERT OR UPDATE ON public.queue_group_challenges DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.queue_group_enterprise_guard();


--
-- Name: queue_groups queue_groups_enterprise_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER queue_groups_enterprise_guard AFTER UPDATE OF enterprise_id ON public.queue_groups DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.queue_group_enterprise_guard();


--
-- Name: queue_groups queue_groups_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_groups_updated_at BEFORE UPDATE ON public.queue_groups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: repos repos_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER repos_updated_at BEFORE UPDATE ON public.repos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: review_fixture_accounts review_fixture_accounts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER review_fixture_accounts_updated_at BEFORE UPDATE ON public.review_fixture_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: review_fixture_queues review_fixture_queues_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER review_fixture_queues_updated_at BEFORE UPDATE ON public.review_fixture_queues FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: roles roles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER roles_updated_at BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: room_queue_groups room_queue_groups_enterprise_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER room_queue_groups_enterprise_guard AFTER INSERT OR UPDATE ON public.room_queue_groups DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.room_queue_group_enterprise_guard();


--
-- Name: room_queue_state room_queue_state_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER room_queue_state_updated_at BEFORE UPDATE ON public.room_queue_state FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: rooms rooms_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER rooms_updated_at BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: schedule schedule_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER schedule_updated_at BEFORE UPDATE ON public.schedule FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sessions sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sessions_updated_at BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sponsor_faq sponsor_faq_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sponsor_faq_updated_at BEFORE UPDATE ON public.sponsor_faq FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tv_slots tv_slots_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tv_slots_set_updated_at BEFORE UPDATE ON public.tv_slots FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_invite_links user_invite_links_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_invite_links_updated_at BEFORE UPDATE ON public.user_invite_links FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users users_badge_assigned_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_badge_assigned_at BEFORE INSERT OR UPDATE OF badge_id ON public.users FOR EACH ROW EXECUTE FUNCTION public.h54_set_badge_assigned_at();


--
-- Name: users users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: verifications verifications_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER verifications_updated_at BEFORE UPDATE ON public.verifications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: account_removal_pin_challenges account_removal_pin_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_removal_pin_challenges
    ADD CONSTRAINT account_removal_pin_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: accounts accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: activities activities_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedule(id) ON DELETE SET NULL;


--
-- Name: activity_logs activity_logs_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id);


--
-- Name: activity_logs activity_logs_logged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES public.users(id);


--
-- Name: activity_logs activity_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: announcement_reads announcement_reads_announcement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_reads
    ADD CONSTRAINT announcement_reads_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id);


--
-- Name: announcement_reads announcement_reads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_reads
    ADD CONSTRAINT announcement_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: announcement_recipients announcement_recipients_announcement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_recipients
    ADD CONSTRAINT announcement_recipients_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE CASCADE;


--
-- Name: announcement_recipients announcement_recipients_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_recipients
    ADD CONSTRAINT announcement_recipients_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: announcements announcements_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: anonymous_participant_fields anonymous_participant_fields_anonymous_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anonymous_participant_fields
    ADD CONSTRAINT anonymous_participant_fields_anonymous_participant_id_fkey FOREIGN KEY (anonymous_participant_id) REFERENCES public.anonymous_participants(id) ON DELETE CASCADE;


--
-- Name: anonymous_participant_fields anonymous_participant_fields_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anonymous_participant_fields
    ADD CONSTRAINT anonymous_participant_fields_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE RESTRICT;


--
-- Name: applicant_reviews applicant_reviews_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applicant_reviews
    ADD CONSTRAINT applicant_reviews_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: applicant_reviews applicant_reviews_response_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applicant_reviews
    ADD CONSTRAINT applicant_reviews_response_id_fkey FOREIGN KEY (response_id) REFERENCES public.application_responses(id);


--
-- Name: application_form_versions application_form_versions_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_form_versions
    ADD CONSTRAINT application_form_versions_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: application_form_versions application_form_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_form_versions
    ADD CONSTRAINT application_form_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: application_grants_roles application_grants_roles_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_grants_roles
    ADD CONSTRAINT application_grants_roles_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: application_grants_roles application_grants_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_grants_roles
    ADD CONSTRAINT application_grants_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: application_responses application_responses_application_form_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_responses
    ADD CONSTRAINT application_responses_application_form_version_id_fkey FOREIGN KEY (application_form_version_id) REFERENCES public.application_form_versions(id) ON DELETE RESTRICT;


--
-- Name: application_responses application_responses_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_responses
    ADD CONSTRAINT application_responses_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id);


--
-- Name: application_responses application_responses_confirmation_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_responses
    ADD CONSTRAINT application_responses_confirmation_token_id_fkey FOREIGN KEY (confirmation_token_id) REFERENCES public.email_verification_tokens(id);


--
-- Name: application_responses application_responses_form_version_application_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_responses
    ADD CONSTRAINT application_responses_form_version_application_fk FOREIGN KEY (application_id, application_form_version_id) REFERENCES public.application_form_versions(application_id, id) ON DELETE RESTRICT;


--
-- Name: application_responses application_responses_referrer_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_responses
    ADD CONSTRAINT application_responses_referrer_application_id_fkey FOREIGN KEY (referrer_application_id) REFERENCES public.application_responses(id);


--
-- Name: application_responses application_responses_referrer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_responses
    ADD CONSTRAINT application_responses_referrer_user_id_fkey FOREIGN KEY (referrer_user_id) REFERENCES public.users(id);


--
-- Name: application_responses application_responses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_responses
    ADD CONSTRAINT application_responses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: attempt_review attempt_review_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attempt_review
    ADD CONSTRAINT attempt_review_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.queue_entries(id);


--
-- Name: attempt_review_versions attempt_review_versions_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attempt_review_versions
    ADD CONSTRAINT attempt_review_versions_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.queue_entries(id);


--
-- Name: attempt_review_versions attempt_review_versions_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attempt_review_versions
    ADD CONSTRAINT attempt_review_versions_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: audit_log audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: challenge_versions challenge_versions_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_versions
    ADD CONSTRAINT challenge_versions_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE CASCADE;


--
-- Name: challenge_versions challenge_versions_editor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_versions
    ADD CONSTRAINT challenge_versions_editor_id_fkey FOREIGN KEY (editor_id) REFERENCES public.users(id);


--
-- Name: challenge_winners challenge_winners_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_winners
    ADD CONSTRAINT challenge_winners_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.challenges(id);


--
-- Name: challenge_winners challenge_winners_repo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_winners
    ADD CONSTRAINT challenge_winners_repo_id_fkey FOREIGN KEY (repo_id) REFERENCES public.repos(id);


--
-- Name: challenge_winners challenge_winners_set_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_winners
    ADD CONSTRAINT challenge_winners_set_by_fkey FOREIGN KEY (set_by) REFERENCES public.users(id);


--
-- Name: challenges challenges_author_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenges
    ADD CONSTRAINT challenges_author_fkey FOREIGN KEY (author) REFERENCES public.sponsors(id);


--
-- Name: check_in_logs check_in_logs_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_in_logs
    ADD CONSTRAINT check_in_logs_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.users(id);


--
-- Name: check_in_logs check_in_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_in_logs
    ADD CONSTRAINT check_in_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: data_subject_requests data_subject_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_subject_requests
    ADD CONSTRAINT data_subject_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: data_subject_requests data_subject_requests_subject_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_subject_requests
    ADD CONSTRAINT data_subject_requests_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES public.users(id);


--
-- Name: devpost_participants devpost_participants_linked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devpost_participants
    ADD CONSTRAINT devpost_participants_linked_by_fkey FOREIGN KEY (linked_by) REFERENCES public.users(id);


--
-- Name: devpost_participants devpost_participants_repo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devpost_participants
    ADD CONSTRAINT devpost_participants_repo_id_fkey FOREIGN KEY (repo_id) REFERENCES public.repos(id);


--
-- Name: devpost_participants devpost_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devpost_participants
    ADD CONSTRAINT devpost_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: email_verification_tokens email_verification_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: enterprise_invite_link_redemptions enterprise_invite_link_redemptions_link_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprise_invite_link_redemptions
    ADD CONSTRAINT enterprise_invite_link_redemptions_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.enterprise_invite_links(id) ON DELETE CASCADE;


--
-- Name: enterprise_invite_link_redemptions enterprise_invite_link_redemptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprise_invite_link_redemptions
    ADD CONSTRAINT enterprise_invite_link_redemptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: enterprise_invite_links enterprise_invite_links_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprise_invite_links
    ADD CONSTRAINT enterprise_invite_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: enterprise_invite_links enterprise_invite_links_enterprise_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprise_invite_links
    ADD CONSTRAINT enterprise_invite_links_enterprise_id_fkey FOREIGN KEY (enterprise_id) REFERENCES public.enterprises(id) ON DELETE CASCADE;


--
-- Name: enterprise_judges enterprise_judges_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprise_judges
    ADD CONSTRAINT enterprise_judges_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id);


--
-- Name: enterprise_judges enterprise_judges_enterprise_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprise_judges
    ADD CONSTRAINT enterprise_judges_enterprise_id_fkey FOREIGN KEY (enterprise_id) REFERENCES public.enterprises(id);


--
-- Name: enterprise_judges enterprise_judges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprise_judges
    ADD CONSTRAINT enterprise_judges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: enterprises enterprises_director_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprises
    ADD CONSTRAINT enterprises_director_id_fkey FOREIGN KEY (director_id) REFERENCES public.users(id);


--
-- Name: email_verification_tokens evt_enterprise_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT evt_enterprise_fk FOREIGN KEY (enterprise_id) REFERENCES public.enterprises(id);


--
-- Name: food_intolerances food_intolerances_proposed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_intolerances
    ADD CONSTRAINT food_intolerances_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES public.users(id);


--
-- Name: judging_session judging_session_judge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.judging_session
    ADD CONSTRAINT judging_session_judge_id_fkey FOREIGN KEY (judge_id) REFERENCES public.users(id);


--
-- Name: judging_session judging_session_queue_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.judging_session
    ADD CONSTRAINT judging_session_queue_entry_id_fkey FOREIGN KEY (queue_entry_id) REFERENCES public.queue_entries(id);


--
-- Name: judging_session judging_session_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.judging_session
    ADD CONSTRAINT judging_session_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id);


--
-- Name: meal_scan_batch_items meal_scan_batch_items_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meal_scan_batch_items
    ADD CONSTRAINT meal_scan_batch_items_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id);


--
-- Name: meal_scan_batch_items meal_scan_batch_items_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meal_scan_batch_items
    ADD CONSTRAINT meal_scan_batch_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.meal_scan_batches(id) ON DELETE CASCADE;


--
-- Name: meal_scan_batches meal_scan_batches_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meal_scan_batches
    ADD CONSTRAINT meal_scan_batches_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id);


--
-- Name: meal_scan_batches meal_scan_batches_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meal_scan_batches
    ADD CONSTRAINT meal_scan_batches_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id);


--
-- Name: notification_outbox notification_outbox_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: push_tokens push_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: queue_entries queue_entries_assigned_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_assigned_room_id_fkey FOREIGN KEY (assigned_room_id) REFERENCES public.rooms(id);


--
-- Name: queue_entries queue_entries_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.challenges(id);


--
-- Name: queue_entries queue_entries_repo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_repo_id_fkey FOREIGN KEY (repo_id) REFERENCES public.repos(id);


--
-- Name: queue_group_challenges queue_group_challenges_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_group_challenges
    ADD CONSTRAINT queue_group_challenges_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE CASCADE;


--
-- Name: queue_group_challenges queue_group_challenges_queue_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_group_challenges
    ADD CONSTRAINT queue_group_challenges_queue_group_id_fkey FOREIGN KEY (queue_group_id) REFERENCES public.queue_groups(id) ON DELETE CASCADE;


--
-- Name: queue_groups queue_groups_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_groups
    ADD CONSTRAINT queue_groups_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: queue_groups queue_groups_enterprise_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_groups
    ADD CONSTRAINT queue_groups_enterprise_id_fkey FOREIGN KEY (enterprise_id) REFERENCES public.enterprises(id);


--
-- Name: queue_history queue_history_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_history
    ADD CONSTRAINT queue_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: queue_history queue_history_queue_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_history
    ADD CONSTRAINT queue_history_queue_entry_id_fkey FOREIGN KEY (queue_entry_id) REFERENCES public.queue_entries(id);


--
-- Name: repo_devpost_prizes repo_devpost_prizes_repo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repo_devpost_prizes
    ADD CONSTRAINT repo_devpost_prizes_repo_id_fkey FOREIGN KEY (repo_id) REFERENCES public.repos(id);


--
-- Name: repos repos_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repos
    ADD CONSTRAINT repos_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: review_fixture_accounts review_fixture_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_fixture_accounts
    ADD CONSTRAINT review_fixture_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: review_fixture_queues review_fixture_queues_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_fixture_queues
    ADD CONSTRAINT review_fixture_queues_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE SET NULL;


--
-- Name: review_fixture_queues review_fixture_queues_enterprise_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_fixture_queues
    ADD CONSTRAINT review_fixture_queues_enterprise_id_fkey FOREIGN KEY (enterprise_id) REFERENCES public.enterprises(id) ON DELETE SET NULL;


--
-- Name: review_fixture_queues review_fixture_queues_fixture_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_fixture_queues
    ADD CONSTRAINT review_fixture_queues_fixture_key_fkey FOREIGN KEY (fixture_key) REFERENCES public.review_fixture_accounts(fixture_key) ON DELETE CASCADE;


--
-- Name: review_fixture_queues review_fixture_queues_queue_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_fixture_queues
    ADD CONSTRAINT review_fixture_queues_queue_entry_id_fkey FOREIGN KEY (queue_entry_id) REFERENCES public.queue_entries(id) ON DELETE SET NULL;


--
-- Name: review_fixture_queues review_fixture_queues_repo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_fixture_queues
    ADD CONSTRAINT review_fixture_queues_repo_id_fkey FOREIGN KEY (repo_id) REFERENCES public.repos(id) ON DELETE SET NULL;


--
-- Name: review_fixture_queues review_fixture_queues_sponsor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_fixture_queues
    ADD CONSTRAINT review_fixture_queues_sponsor_id_fkey FOREIGN KEY (sponsor_id) REFERENCES public.sponsors(id) ON DELETE SET NULL;


--
-- Name: role_capabilities role_capabilities_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_capabilities
    ADD CONSTRAINT role_capabilities_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: role_grant_rules role_grant_rules_enterprise_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_grant_rules
    ADD CONSTRAINT role_grant_rules_enterprise_id_fkey FOREIGN KEY (enterprise_id) REFERENCES public.enterprises(id) ON DELETE CASCADE;


--
-- Name: role_grant_rules role_grant_rules_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_grant_rules
    ADD CONSTRAINT role_grant_rules_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: role_grant_rules role_grant_rules_source_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_grant_rules
    ADD CONSTRAINT role_grant_rules_source_role_id_fkey FOREIGN KEY (source_role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: role_seed_defaults role_seed_defaults_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_seed_defaults
    ADD CONSTRAINT role_seed_defaults_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: room_queue_groups room_challenges_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_queue_groups
    ADD CONSTRAINT room_challenges_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: room_queue_groups room_challenges_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_queue_groups
    ADD CONSTRAINT room_challenges_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id);


--
-- Name: room_enterprises room_enterprises_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_enterprises
    ADD CONSTRAINT room_enterprises_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: room_enterprises room_enterprises_enterprise_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_enterprises
    ADD CONSTRAINT room_enterprises_enterprise_id_fkey FOREIGN KEY (enterprise_id) REFERENCES public.enterprises(id);


--
-- Name: room_enterprises room_enterprises_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_enterprises
    ADD CONSTRAINT room_enterprises_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: room_queue_groups room_queue_groups_queue_group_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_queue_groups
    ADD CONSTRAINT room_queue_groups_queue_group_id_fk FOREIGN KEY (queue_group_id) REFERENCES public.queue_groups(id) ON DELETE CASCADE;


--
-- Name: room_queue_state room_queue_state_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_queue_state
    ADD CONSTRAINT room_queue_state_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: schedule_owners schedule_owners_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_owners
    ADD CONSTRAINT schedule_owners_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: schedule_owners schedule_owners_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_owners
    ADD CONSTRAINT schedule_owners_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedule(id) ON DELETE CASCADE;


--
-- Name: schedule_owners schedule_owners_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_owners
    ADD CONSTRAINT schedule_owners_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sponsors sponsors_enterprise_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sponsors
    ADD CONSTRAINT sponsors_enterprise_id_fkey FOREIGN KEY (enterprise_id) REFERENCES public.enterprises(id);


--
-- Name: sponsors sponsors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sponsors
    ADD CONSTRAINT sponsors_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: statistics_scope_panel_role_access statistics_scope_panel_role_access_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_scope_panel_role_access
    ADD CONSTRAINT statistics_scope_panel_role_access_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: submissions submissions_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: submissions submissions_repo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_repo_id_fkey FOREIGN KEY (repo_id) REFERENCES public.repos(id);


--
-- Name: submissions submissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: tickets tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: time_logs time_logs_scanned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_logs
    ADD CONSTRAINT time_logs_scanned_by_fkey FOREIGN KEY (scanned_by) REFERENCES public.users(id);


--
-- Name: time_logs time_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_logs
    ADD CONSTRAINT time_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: universities universities_proposed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.universities
    ADD CONSTRAINT universities_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES public.users(id);


--
-- Name: universities universities_suggested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.universities
    ADD CONSTRAINT universities_suggested_by_fkey FOREIGN KEY (suggested_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_email_history user_email_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_email_history
    ADD CONSTRAINT user_email_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_invite_link_redemptions user_invite_link_redemptions_link_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invite_link_redemptions
    ADD CONSTRAINT user_invite_link_redemptions_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.user_invite_links(id) ON DELETE CASCADE;


--
-- Name: user_invite_link_redemptions user_invite_link_redemptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invite_link_redemptions
    ADD CONSTRAINT user_invite_link_redemptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_invite_links user_invite_links_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invite_links
    ADD CONSTRAINT user_invite_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_invite_links user_invite_links_enterprise_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invite_links
    ADD CONSTRAINT user_invite_links_enterprise_id_fkey FOREIGN KEY (enterprise_id) REFERENCES public.enterprises(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_university_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_university_fk FOREIGN KEY (university_id) REFERENCES public.universities(id);


--
-- Name: wallet_access_tokens wallet_access_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_access_tokens
    ADD CONSTRAINT wallet_access_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: wallet_pass_devices wallet_pass_devices_pass_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_pass_devices
    ADD CONSTRAINT wallet_pass_devices_pass_id_fkey FOREIGN KEY (pass_id) REFERENCES public.wallet_passes(id);


--
-- Name: wallet_passes wallet_passes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_passes
    ADD CONSTRAINT wallet_passes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--



-- ── Required application defaults ────────────────────────────────────────

-- Required system configuration and default role hierarchy. These are the only data
-- rows in the baseline; all operational tables start empty.
INSERT INTO public.roles OVERRIDING SYSTEM VALUE VALUES (1, 'Sponsor', 1000, true, false, true, '2026-09-19 18:54:08.005403+00', '2026-09-19 18:54:08.05124+00', NULL, true);
INSERT INTO public.roles OVERRIDING SYSTEM VALUE VALUES (12, 'Organizer', 5000, true, false, true, '2026-09-19 18:54:08.029357+00', '2026-09-19 18:54:08.05124+00', NULL, true);
INSERT INTO public.roles OVERRIDING SYSTEM VALUE VALUES (13, 'Day Staff', 4000, true, false, true, '2026-09-19 18:54:08.029357+00', '2026-09-19 18:54:08.05124+00', NULL, true);
INSERT INTO public.roles OVERRIDING SYSTEM VALUE VALUES (14, 'Mentor', 1500, true, false, true, '2026-09-19 18:54:08.029357+00', '2026-09-19 18:54:08.05124+00', NULL, true);
INSERT INTO public.roles OVERRIDING SYSTEM VALUE VALUES (15, 'Participant', 500, true, false, true, '2026-09-19 18:54:08.029357+00', '2026-09-19 18:54:08.05124+00', NULL, true);
INSERT INTO public.roles OVERRIDING SYSTEM VALUE VALUES (2, 'Event Director', 18700, false, false, true, '2026-09-19 18:54:08.029357+00', '2026-09-19 18:54:08.05124+00', NULL, true);
INSERT INTO public.roles OVERRIDING SYSTEM VALUE VALUES (3, 'Judging Coordinator', 8200, false, false, true, '2026-09-19 18:54:08.029357+00', '2026-09-19 18:54:08.05124+00', NULL, true);
INSERT INTO public.roles OVERRIDING SYSTEM VALUE VALUES (4, 'Applications Lead', 8100, false, false, true, '2026-09-19 18:54:08.029357+00', '2026-09-19 18:54:08.05124+00', NULL, true);
INSERT INTO public.roles OVERRIDING SYSTEM VALUE VALUES (5, 'Judging Team', 8000, false, false, true, '2026-09-19 18:54:08.029357+00', '2026-09-19 18:54:08.05124+00', NULL, true);
INSERT INTO public.roles OVERRIDING SYSTEM VALUE VALUES (6, 'Applications Team', 7900, false, false, true, '2026-09-19 18:54:08.029357+00', '2026-09-19 18:54:08.05124+00', NULL, true);
INSERT INTO public.roles OVERRIDING SYSTEM VALUE VALUES (7, 'Operations Team', 7800, false, false, true, '2026-09-19 18:54:08.029357+00', '2026-09-19 18:54:08.05124+00', NULL, true);
INSERT INTO public.roles OVERRIDING SYSTEM VALUE VALUES (8, 'Hacker Experience', 7700, false, false, true, '2026-09-19 18:54:08.029357+00', '2026-09-19 18:54:08.05124+00', NULL, true);
INSERT INTO public.roles OVERRIDING SYSTEM VALUE VALUES (9, 'Sponsors Team', 7600, false, false, true, '2026-09-19 18:54:08.029357+00', '2026-09-19 18:54:08.05124+00', NULL, true);
INSERT INTO public.roles OVERRIDING SYSTEM VALUE VALUES (10, 'Media / Comms', 7500, false, false, true, '2026-09-19 18:54:08.029357+00', '2026-09-19 18:54:08.05124+00', NULL, true);
INSERT INTO public.roles OVERRIDING SYSTEM VALUE VALUES (11, 'Technical Team', 7400, false, false, true, '2026-09-19 18:54:08.029357+00', '2026-09-19 18:54:08.05124+00', NULL, true);
INSERT INTO public.event_config VALUES (1, NULL, NULL, 'Europe/Madrid', NULL, NULL, '2026-09-19 18:54:07.381957+00', false, NULL, NULL, NULL, '[]', '{}', NULL, '{}', NULL, NULL, NULL, NULL, false, false, false, false, '{XS,S,M,L,XL,XXL}', false, NULL, 720);
INSERT INTO public.queue_settings VALUES (1, 5, NULL, NULL, 10, 'ask', 10);
INSERT INTO public.review_fixture_accounts VALUES ('participant-delete', NULL, 0, NULL, '2026-09-19 18:54:07.953653+00', '2026-09-19 18:54:07.953653+00', NULL);
INSERT INTO public.review_fixture_accounts VALUES ('participant-anonymize-outside', NULL, 0, NULL, '2026-09-19 18:54:07.954837+00', '2026-09-19 18:54:07.954837+00', NULL);
INSERT INTO public.review_fixture_accounts VALUES ('participant-anonymize-inside', NULL, 0, NULL, '2026-09-19 18:54:07.954848+00', '2026-09-19 18:54:07.954848+00', NULL);
INSERT INTO public.review_fixture_accounts VALUES ('staff-exit-operator', NULL, 0, NULL, '2026-09-19 18:54:07.954854+00', '2026-09-19 18:54:07.954854+00', NULL);
INSERT INTO public.role_capabilities VALUES (2, 'users:read', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'users:write', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'permissions:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'invites:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'applications:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'applications:review', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'applications:decide', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'applications:confirm-override', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'applications:edit-response', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'projects:read', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'projects:import', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'projects:edit', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'accredit:scan', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'presence:scan', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'activity:scan', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'logistics:stats', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'intolerances:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'queue:operate', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'queue:admin', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'judge:panel', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'judging:export', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'sponsors:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'challenges:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'schedule:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'announcements:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'tv:control', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'event:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'venue:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'wallet:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'presence:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'notifications:send', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'audit:read', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'exports:run', 'allow');
INSERT INTO public.role_capabilities VALUES (12, 'users:read', 'allow');
INSERT INTO public.role_capabilities VALUES (12, 'applications:review', 'allow');
INSERT INTO public.role_capabilities VALUES (12, 'projects:read', 'allow');
INSERT INTO public.role_capabilities VALUES (12, 'accredit:scan', 'allow');
INSERT INTO public.role_capabilities VALUES (12, 'presence:scan', 'allow');
INSERT INTO public.role_capabilities VALUES (12, 'activity:scan', 'allow');
INSERT INTO public.role_capabilities VALUES (12, 'logistics:stats', 'allow');
INSERT INTO public.role_capabilities VALUES (13, 'accredit:scan', 'allow');
INSERT INTO public.role_capabilities VALUES (13, 'presence:scan', 'allow');
INSERT INTO public.role_capabilities VALUES (13, 'activity:scan', 'allow');
INSERT INTO public.role_capabilities VALUES (13, 'logistics:stats', 'allow');
INSERT INTO public.role_capabilities VALUES (6, 'applications:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (6, 'applications:review', 'allow');
INSERT INTO public.role_capabilities VALUES (4, 'applications:decide', 'allow');
INSERT INTO public.role_capabilities VALUES (4, 'applications:edit-response', 'allow');
INSERT INTO public.role_capabilities VALUES (7, 'accredit:scan', 'allow');
INSERT INTO public.role_capabilities VALUES (7, 'presence:scan', 'allow');
INSERT INTO public.role_capabilities VALUES (7, 'activity:scan', 'allow');
INSERT INTO public.role_capabilities VALUES (7, 'logistics:stats', 'allow');
INSERT INTO public.role_capabilities VALUES (7, 'intolerances:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (7, 'venue:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (7, 'presence:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (8, 'projects:read', 'allow');
INSERT INTO public.role_capabilities VALUES (8, 'activity:scan', 'allow');
INSERT INTO public.role_capabilities VALUES (8, 'schedule:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (8, 'tv:control', 'allow');
INSERT INTO public.role_capabilities VALUES (8, 'challenges:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (9, 'sponsors:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (9, 'challenges:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (5, 'projects:read', 'allow');
INSERT INTO public.role_capabilities VALUES (5, 'projects:import', 'allow');
INSERT INTO public.role_capabilities VALUES (5, 'projects:edit', 'allow');
INSERT INTO public.role_capabilities VALUES (5, 'queue:operate', 'allow');
INSERT INTO public.role_capabilities VALUES (5, 'judge:panel', 'allow');
INSERT INTO public.role_capabilities VALUES (3, 'queue:admin', 'allow');
INSERT INTO public.role_capabilities VALUES (3, 'judging:export', 'allow');
INSERT INTO public.role_capabilities VALUES (10, 'schedule:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (10, 'announcements:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (10, 'tv:control', 'allow');
INSERT INTO public.role_capabilities VALUES (11, 'users:read', 'allow');
INSERT INTO public.role_capabilities VALUES (11, 'users:write', 'allow');
INSERT INTO public.role_capabilities VALUES (11, 'audit:read', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'statistics:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (4, 'statistics:manage', 'allow');
INSERT INTO public.role_capabilities VALUES (15, 'queue:status', 'allow');
INSERT INTO public.role_capabilities VALUES (2, 'queue:status', 'allow');
INSERT INTO public.role_grant_rules OVERRIDING SYSTEM VALUE VALUES (1, 1, 'sponsor.enterprise_linked', 'grant', true, NULL, NULL);
INSERT INTO public.role_grant_rules OVERRIDING SYSTEM VALUE VALUES (2, 1, 'sponsor.enterprise_unlinked', 'revoke', true, NULL, NULL);
INSERT INTO public.role_grant_rules OVERRIDING SYSTEM VALUE VALUES (3, 12, NULL, 'grant', true, NULL, 2);
INSERT INTO public.role_grant_rules OVERRIDING SYSTEM VALUE VALUES (4, 12, NULL, 'grant', true, NULL, 3);
INSERT INTO public.role_grant_rules OVERRIDING SYSTEM VALUE VALUES (5, 12, NULL, 'grant', true, NULL, 4);
INSERT INTO public.role_grant_rules OVERRIDING SYSTEM VALUE VALUES (6, 12, NULL, 'grant', true, NULL, 5);
INSERT INTO public.role_grant_rules OVERRIDING SYSTEM VALUE VALUES (7, 12, NULL, 'grant', true, NULL, 6);
INSERT INTO public.role_grant_rules OVERRIDING SYSTEM VALUE VALUES (8, 12, NULL, 'grant', true, NULL, 7);
INSERT INTO public.role_grant_rules OVERRIDING SYSTEM VALUE VALUES (9, 12, NULL, 'grant', true, NULL, 8);
INSERT INTO public.role_grant_rules OVERRIDING SYSTEM VALUE VALUES (10, 12, NULL, 'grant', true, NULL, 9);
INSERT INTO public.role_grant_rules OVERRIDING SYSTEM VALUE VALUES (11, 12, NULL, 'grant', true, NULL, 10);
INSERT INTO public.role_grant_rules OVERRIDING SYSTEM VALUE VALUES (12, 12, NULL, 'grant', true, NULL, 11);
INSERT INTO public.role_seed_defaults VALUES (1, '{}', true);
INSERT INTO public.role_seed_defaults VALUES (3, '{"queue:admin": "allow", "judging:export": "allow"}', true);
INSERT INTO public.role_seed_defaults VALUES (5, '{"judge:panel": "allow", "projects:edit": "allow", "projects:read": "allow", "queue:operate": "allow", "projects:import": "allow"}', true);
INSERT INTO public.role_seed_defaults VALUES (6, '{"applications:manage": "allow", "applications:review": "allow"}', true);
INSERT INTO public.role_seed_defaults VALUES (7, '{"venue:manage": "allow", "accredit:scan": "allow", "activity:scan": "allow", "presence:scan": "allow", "logistics:stats": "allow", "presence:manage": "allow", "intolerances:manage": "allow"}', true);
INSERT INTO public.role_seed_defaults VALUES (8, '{"tv:control": "allow", "activity:scan": "allow", "projects:read": "allow", "schedule:manage": "allow", "challenges:manage": "allow"}', true);
INSERT INTO public.role_seed_defaults VALUES (9, '{"sponsors:manage": "allow", "challenges:manage": "allow"}', true);
INSERT INTO public.role_seed_defaults VALUES (10, '{"tv:control": "allow", "schedule:manage": "allow", "announcements:manage": "allow"}', true);
INSERT INTO public.role_seed_defaults VALUES (11, '{"audit:read": "allow", "users:read": "allow", "users:write": "allow"}', true);
INSERT INTO public.role_seed_defaults VALUES (12, '{"users:read": "allow", "accredit:scan": "allow", "activity:scan": "allow", "presence:scan": "allow", "projects:read": "allow", "logistics:stats": "allow", "applications:review": "allow"}', true);
INSERT INTO public.role_seed_defaults VALUES (13, '{"accredit:scan": "allow", "activity:scan": "allow", "presence:scan": "allow", "logistics:stats": "allow"}', true);
INSERT INTO public.role_seed_defaults VALUES (14, '{}', true);
INSERT INTO public.role_seed_defaults VALUES (4, '{"statistics:manage": "allow", "applications:decide": "allow", "applications:edit-response": "allow"}', true);
INSERT INTO public.role_seed_defaults VALUES (15, '{"queue:status": "allow"}', true);
INSERT INTO public.role_seed_defaults VALUES (2, '{"audit:read": "allow", "tv:control": "allow", "users:read": "allow", "exports:run": "allow", "judge:panel": "allow", "queue:admin": "allow", "users:write": "allow", "event:manage": "allow", "queue:status": "allow", "venue:manage": "allow", "accredit:scan": "allow", "activity:scan": "allow", "presence:scan": "allow", "projects:edit": "allow", "projects:read": "allow", "queue:operate": "allow", "wallet:manage": "allow", "invites:manage": "allow", "judging:export": "allow", "logistics:stats": "allow", "presence:manage": "allow", "projects:import": "allow", "schedule:manage": "allow", "sponsors:manage": "allow", "challenges:manage": "allow", "statistics:manage": "allow", "notifications:send": "allow", "permissions:manage": "allow", "applications:decide": "allow", "applications:manage": "allow", "applications:review": "allow", "intolerances:manage": "allow", "announcements:manage": "allow", "applications:edit-response": "allow", "applications:confirm-override": "allow"}', true);
INSERT INTO public.sponsor_faq VALUES (1, '2026-09-19 18:54:07.875175+00', '[]');

-- Explicit identities were used for roles and grant rules; advance their sequences.
SELECT pg_catalog.setval('public.role_grant_rules_id_seq', 12, true);
SELECT pg_catalog.setval('public.roles_id_seq', 16, true);

-- pg_dump clears search_path while emitting fully-qualified DDL. The migration
-- runner records its ledger row immediately after this file, so restore public.
SET search_path = public;


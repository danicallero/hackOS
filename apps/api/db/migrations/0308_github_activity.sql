-- GitHub App repo linking and event activity ranking.
-- DELTA: not in plan/schema-boceto.dbml; a project links one GitHub
-- repository through a GitHub App installation, commits and pull requests
-- arrive by webhook or backfill and are ranked within the hacking window.

CREATE TABLE github_accounts (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  github_id bigint NOT NULL UNIQUE,
  login text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER github_accounts_set_updated_at BEFORE UPDATE ON github_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Installations the user proved access to during the OAuth step of the flow.
CREATE TABLE github_user_installations (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id bigint NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, installation_id)
);

CREATE TABLE github_repo_links (
  repo_id integer PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
  installation_id bigint NOT NULL,
  github_repo_id bigint NOT NULL UNIQUE,
  full_name text NOT NULL,
  is_private boolean NOT NULL DEFAULT false,
  linked_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX github_repo_links_installation_idx ON github_repo_links (installation_id);

CREATE TABLE github_commits (
  repo_id integer NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  sha text NOT NULL,
  author_login text,
  committed_at timestamptz NOT NULL,
  PRIMARY KEY (repo_id, sha)
);
CREATE INDEX github_commits_committed_idx ON github_commits (committed_at);

CREATE TABLE github_pull_requests (
  repo_id integer NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  number integer NOT NULL,
  author_login text,
  state text NOT NULL CHECK (state IN ('open', 'closed')),
  merged_at timestamptz,
  opened_at timestamptz NOT NULL,
  PRIMARY KEY (repo_id, number)
);
CREATE INDEX github_pull_requests_opened_idx ON github_pull_requests (opened_at);

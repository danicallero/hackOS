-- DELTA(H11,H16,H53): catalogues belong to a dynamic question, not event settings.
CREATE TABLE form_libraries (
 id uuid PRIMARY KEY,
 application_id integer REFERENCES applications(id) ON DELETE CASCADE,
 project boolean NOT NULL DEFAULT false,
 field_key text NOT NULL,
 CHECK ((application_id IS NOT NULL) <> project)
);
CREATE UNIQUE INDEX form_libraries_application_field ON form_libraries(application_id,field_key) WHERE NOT project;
CREATE UNIQUE INDEX form_libraries_project_field ON form_libraries(field_key) WHERE project;
CREATE TABLE form_library_values (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 library_id uuid NOT NULL REFERENCES form_libraries(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
 is_test_account boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX form_library_values_name ON form_library_values(library_id,lower(name),is_test_account);

-- H11/H27: Spanish provinces in stored city answers get one spelling too
-- ("La Coruña"/"Coruña" → "A Coruña", "Orense" → "Ourense"), matching
-- canonicalRegion in @hackos/shared/places, which new writes already use.
-- 0209 covered countries and autonomous communities; aliases are generated
-- from SPANISH_PROVINCES in that module.
-- DELTA(H11): no schema change; data only.

CREATE TEMP TABLE city_es_province_alias (alias text PRIMARY KEY, canonical text NOT NULL) ON COMMIT DROP;
INSERT INTO city_es_province_alias (alias, canonical) VALUES
  ('a coruna', 'A Coruña'),
  ('a coruña', 'A Coruña'),
  ('alacant', 'Alicante'),
  ('alava', 'Álava'),
  ('álava', 'Álava'),
  ('alava/araba', 'Álava'),
  ('álava/araba', 'Álava'),
  ('albacete', 'Albacete'),
  ('alicante', 'Alicante'),
  ('alicante/alacant', 'Alicante'),
  ('almeria', 'Almería'),
  ('almería', 'Almería'),
  ('araba', 'Álava'),
  ('araba/alava', 'Álava'),
  ('araba/álava', 'Álava'),
  ('avila', 'Ávila'),
  ('ávila', 'Ávila'),
  ('badajoz', 'Badajoz'),
  ('barcelona', 'Barcelona'),
  ('biscay', 'Bizkaia'),
  ('bizkaia', 'Bizkaia'),
  ('burgos', 'Burgos'),
  ('caceres', 'Cáceres'),
  ('cáceres', 'Cáceres'),
  ('cadiz', 'Cádiz'),
  ('cádiz', 'Cádiz'),
  ('castello', 'Castellón'),
  ('castelló', 'Castellón'),
  ('castellon', 'Castellón'),
  ('castellón', 'Castellón'),
  ('castellon de la plana', 'Castellón'),
  ('castellón de la plana', 'Castellón'),
  ('castellon/castello', 'Castellón'),
  ('castellón/castelló', 'Castellón'),
  ('ciudad real', 'Ciudad Real'),
  ('cordoba', 'Córdoba'),
  ('córdoba', 'Córdoba'),
  ('coruna', 'A Coruña'),
  ('coruña', 'A Coruña'),
  ('cuenca', 'Cuenca'),
  ('gerona', 'Girona'),
  ('gipuzkoa', 'Gipuzkoa'),
  ('girona', 'Girona'),
  ('granada', 'Granada'),
  ('guadalajara', 'Guadalajara'),
  ('guipuzcoa', 'Gipuzkoa'),
  ('guipúzcoa', 'Gipuzkoa'),
  ('guipuzkoa', 'Gipuzkoa'),
  ('huelva', 'Huelva'),
  ('huesca', 'Huesca'),
  ('jaen', 'Jaén'),
  ('jaén', 'Jaén'),
  ('la coruna', 'A Coruña'),
  ('la coruña', 'A Coruña'),
  ('las palmas', 'Las Palmas'),
  ('leon', 'León'),
  ('león', 'León'),
  ('lerida', 'Lleida'),
  ('lérida', 'Lleida'),
  ('lleida', 'Lleida'),
  ('lugo', 'Lugo'),
  ('malaga', 'Málaga'),
  ('málaga', 'Málaga'),
  ('orense', 'Ourense'),
  ('ourense', 'Ourense'),
  ('palencia', 'Palencia'),
  ('pontevedra', 'Pontevedra'),
  ('salamanca', 'Salamanca'),
  ('santa cruz de tenerife', 'Santa Cruz de Tenerife'),
  ('saragossa', 'Zaragoza'),
  ('segovia', 'Segovia'),
  ('sevilla', 'Sevilla'),
  ('seville', 'Sevilla'),
  ('soria', 'Soria'),
  ('tarragona', 'Tarragona'),
  ('tenerife', 'Santa Cruz de Tenerife'),
  ('teruel', 'Teruel'),
  ('toledo', 'Toledo'),
  ('valladolid', 'Valladolid'),
  ('vizcaya', 'Bizkaia'),
  ('zamora', 'Zamora'),
  ('zaragoza', 'Zaragoza');

CREATE FUNCTION pg_temp.canonical_province(answer jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(answer) = 'object'
     AND jsonb_typeof(answer -> 'city') = 'string'
     AND jsonb_typeof(answer -> 'province') = 'string'
     AND answer ->> 'country' = 'España'
     AND EXISTS (SELECT 1 FROM city_es_province_alias
                  WHERE alias = lower(btrim(answer ->> 'province')))
    THEN answer || jsonb_build_object('province',
      (SELECT canonical FROM city_es_province_alias
        WHERE alias = lower(btrim(answer ->> 'province'))))
    ELSE answer
  END
$$;

CREATE FUNCTION pg_temp.canonical_province_answers(responses jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN jsonb_typeof(responses) = 'object'
    THEN COALESCE((SELECT jsonb_object_agg(key, pg_temp.canonical_province(value))
                     FROM jsonb_each(responses)), '{}'::jsonb)
    ELSE responses END
$$;

UPDATE application_responses
   SET responses = pg_temp.canonical_province_answers(responses)
 WHERE responses IS DISTINCT FROM pg_temp.canonical_province_answers(responses);

-- Project answers arrive in 0705; a fresh database reaches this file first,
-- with no projects to rewrite.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'repos' AND column_name = 'responses') THEN
    EXECUTE $sql$
      UPDATE repos
         SET responses = pg_temp.canonical_province_answers(responses)
       WHERE responses IS DISTINCT FROM pg_temp.canonical_province_answers(responses)
    $sql$;
  END IF;
END
$$;

UPDATE anonymous_participant_fields
   SET value = pg_temp.canonical_province(value)
 WHERE field_kind = 'city'
   AND value IS DISTINCT FROM pg_temp.canonical_province(value);

-- H11/H27: countries written in their own language ("Polska", "Sverige",
-- "Česko") get the canonical spelling too, matching canonicalCountry in
-- @hackos/shared/places, which now recognizes each country's own name. 0209
-- covered the nine languages the picker and geocoders answer in; aliases here
-- are the remaining endonyms, generated from that module.
-- DELTA(H11): no schema change; data only.

CREATE TEMP TABLE city_country_endonym (alias text PRIMARY KEY, canonical text NOT NULL) ON COMMIT DROP;
INSERT INTO city_country_endonym (alias, canonical) VALUES
  ('azərbaycan', 'Azerbaiyán'),
  ('belgie', 'Bélgica'),
  ('belgië', 'Bélgica'),
  ('bosna i hercegovina', 'Bosnia y Herzegovina'),
  ('bouvetøya', 'Isla Bouvet'),
  ('cesko', 'Chequia'),
  ('česko', 'Chequia'),
  ('danmark', 'Dinamarca'),
  ('eesti', 'Estonia'),
  ('føroyar', 'Islas Feroe'),
  ('gaana', 'Ghana'),
  ('hrvatska', 'Croacia'),
  ('ísland', 'Islandia'),
  ('kalaallit nunaat', 'Groenlandia'),
  ('kepulauan cocos (keeling)', 'Islas Cocos'),
  ('kodorosese ti beafrika', 'República Centroafricana'),
  ('ködörösêse tî bêafrîka', 'República Centroafricana'),
  ('kosove', 'Kosovo'),
  ('kosovë', 'Kosovo'),
  ('latvija', 'Letonia'),
  ('lietuva', 'Lituania'),
  ('madagasikara', 'Madagascar'),
  ('magyarorszag', 'Hungría'),
  ('magyarország', 'Hungría'),
  ('namibië', 'Namibia'),
  ('nederland', 'Países Bajos'),
  ('nijar', 'Níger'),
  ('norge', 'Noruega'),
  ('oʻzbekiston', 'Uzbekistán'),
  ('pilipinas', 'Filipinas'),
  ('polska', 'Polonia'),
  ('românia', 'Rumanía'),
  ('senegaal', 'Senegal'),
  ('shqiperi', 'Albania'),
  ('shqipëri', 'Albania'),
  ('slovenija', 'Eslovenia'),
  ('slovensko', 'Eslovaquia'),
  ('soomaaliya', 'Somalia'),
  ('suomi', 'Finlandia'),
  ('svalbard og jan mayen', 'Svalbard y Jan Mayen'),
  ('sverige', 'Suecia'),
  ('türkmenistan', 'Turkmenistán'),
  ('u rwanda', 'Ruanda'),
  ('uburundi', 'Burundi'),
  ('việt nam', 'Vietnam'),
  ('ελλαδα', 'Grecia'),
  ('ελλάδα', 'Grecia'),
  ('κυπρος', 'Chipre'),
  ('κύπρος', 'Chipre'),
  ('беларусь', 'Bielorrusia'),
  ('българия', 'Bulgaria'),
  ('казахстан', 'Kazajistán'),
  ('кыргызстан', 'Kirguistán'),
  ('монгол', 'Mongolia'),
  ('россия', 'Rusia'),
  ('северна македонија', 'Macedonia del Norte'),
  ('србија', 'Serbia'),
  ('тоҷикистон', 'Tayikistán'),
  ('украіна', 'Ucrania'),
  ('україна', 'Ucrania'),
  ('црна гора', 'Montenegro'),
  ('საქართველო', 'Georgia'),
  ('հայաստան', 'Armenia'),
  ('ישראל', 'Israel'),
  ('افغانستان', 'Afganistán'),
  ('الأراضي الفلسطينية', 'Territorios Palestinos'),
  ('الأردن', 'Jordania'),
  ('الإمارات العربية المتحدة', 'Emiratos Árabes Unidos'),
  ('الاراضي الفلسطينية', 'Territorios Palestinos'),
  ('الاردن', 'Jordania'),
  ('الامارات العربية المتحدة', 'Emiratos Árabes Unidos'),
  ('البحرين', 'Baréin'),
  ('الجزائر', 'Argelia'),
  ('الجزاير', 'Argelia'),
  ('السودان', 'Sudán'),
  ('الصحراء الغربية', 'Sáhara Occidental'),
  ('العراق', 'Irak'),
  ('الكويت', 'Kuwait'),
  ('المغرب', 'Marruecos'),
  ('المملكة العربية السعودية', 'Arabia Saudí'),
  ('اليمن', 'Yemen'),
  ('ایران', 'Irán'),
  ('پاکستان', 'Pakistán'),
  ('تشاد', 'Chad'),
  ('تونس', 'Túnez'),
  ('جزر القمر', 'Comoras'),
  ('جنوب السودان', 'Sudán del Sur'),
  ('سوريا', 'Siria'),
  ('عمان', 'Omán'),
  ('عُمان', 'Omán'),
  ('قطر', 'Catar'),
  ('لبنان', 'Líbano'),
  ('ليبيا', 'Libia'),
  ('مصر', 'Egipto'),
  ('موريتانيا', 'Mauritania'),
  ('ኢትዮጵያ', 'Etiopía'),
  ('ኤርትራ', 'Eritrea'),
  ('नपल', 'Nepal'),
  ('नेपाल', 'Nepal'),
  ('भरत', 'India'),
  ('भारत', 'India'),
  ('বলদশ', 'Bangladés'),
  ('বাংলাদেশ', 'Bangladés'),
  ('ශ‍ර ලකව', 'Sri Lanka'),
  ('ශ්‍රී ලංකාව', 'Sri Lanka'),
  ('ไทย', 'Tailandia'),
  ('ລາວ', 'Laos'),
  ('འབག', 'Bután'),
  ('འབྲུག', 'Bután'),
  ('မနမ', 'Myanmar (Birmania)'),
  ('မြန်မာ', 'Myanmar (Birmania)'),
  ('កមពជ', 'Camboya'),
  ('កម្ពុជា', 'Camboya'),
  ('대한민국', 'Corea del Sur'),
  ('대한민국', 'Corea del Sur'),
  ('북한', 'Corea del Norte'),
  ('북한', 'Corea del Norte'),
  ('中国', 'China'),
  ('中国澳门特别行政区', 'RAE de Macao (China)'),
  ('中国香港特别行政区', 'RAE de Hong Kong (China)'),
  ('台湾', 'Taiwán'),
  ('日本', 'Japón');

CREATE FUNCTION pg_temp.canonical_country(answer jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(answer) = 'object'
     AND jsonb_typeof(answer -> 'city') = 'string'
     AND jsonb_typeof(answer -> 'province') = 'string'
     AND jsonb_typeof(answer -> 'country') = 'string'
     AND EXISTS (SELECT 1 FROM city_country_endonym
                  WHERE alias = lower(btrim(answer ->> 'country')))
    THEN answer || jsonb_build_object('country',
      (SELECT canonical FROM city_country_endonym
        WHERE alias = lower(btrim(answer ->> 'country'))))
    ELSE answer
  END
$$;

CREATE FUNCTION pg_temp.canonical_country_answers(responses jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN jsonb_typeof(responses) = 'object'
    THEN COALESCE((SELECT jsonb_object_agg(key, pg_temp.canonical_country(value))
                     FROM jsonb_each(responses)), '{}'::jsonb)
    ELSE responses END
$$;

UPDATE application_responses
   SET responses = pg_temp.canonical_country_answers(responses)
 WHERE responses IS DISTINCT FROM pg_temp.canonical_country_answers(responses);

-- Project answers arrive in 0705; a fresh database reaches this file first,
-- with no projects to rewrite.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'repos' AND column_name = 'responses') THEN
    EXECUTE $sql$
      UPDATE repos
         SET responses = pg_temp.canonical_country_answers(responses)
       WHERE responses IS DISTINCT FROM pg_temp.canonical_country_answers(responses)
    $sql$;
  END IF;
END
$$;

UPDATE anonymous_participant_fields
   SET value = pg_temp.canonical_country(value)
 WHERE field_kind = 'city'
   AND value IS DISTINCT FROM pg_temp.canonical_country(value);

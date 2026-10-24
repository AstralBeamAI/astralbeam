UPDATE provider_model SET
  pricing_history = CASE WHEN jsonb_array_length(pricing_history) = 0 THEN
    jsonb_build_array(jsonb_build_object('id', uuidv7()::text,
      'effectiveFrom', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'policy', CASE WHEN configuration->'pricingSource'->>'kind' = 'manual'
        THEN jsonb_build_object('kind', 'manual', 'prices', configuration->'prices')
        ELSE jsonb_build_object('kind', 'catalog') END))
    ELSE (SELECT jsonb_agg(jsonb_build_object('id', entry->'id', 'effectiveFrom', entry->'effectiveFrom',
      'policy', CASE WHEN entry->'rates' = 'null'::jsonb THEN jsonb_build_object('kind', 'catalog')
        ELSE jsonb_build_object('kind', 'manual', 'prices', entry->'rates'->'prices') END) ORDER BY ordinal)
      FROM jsonb_array_elements(pricing_history) WITH ORDINALITY AS changes(entry, ordinal)) END,
  configuration = CASE WHEN configuration->'pricingSource'->>'kind' = 'manual'
    THEN configuration - 'currency' - 'pricingSource' - 'prices' - 'contextTiers'
    ELSE NULL END,
  updated_at = now();

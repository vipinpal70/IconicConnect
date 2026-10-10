-- Materialized daily rollups for analytics (refresh CONCURRENTLY every 5 min).

-- migrate:up
CREATE MATERIALIZED VIEW mv_cases_created_daily AS
SELECT date_trunc('day', created_at)::date AS day,
       client_id, category, status,
       count(*) AS cases
  FROM cases
 GROUP BY 1, 2, 3, 4;
CREATE UNIQUE INDEX ON mv_cases_created_daily (day, client_id, category, status);
CREATE INDEX        ON mv_cases_created_daily (client_id, day);

CREATE MATERIALIZED VIEW mv_cases_completed_daily AS
SELECT date_trunc('day', completed_at)::date AS day,
       client_id, category,
       count(*)                      AS cases,
       sum(tat_minutes)              AS tat_minutes_sum,
       count(tat_minutes)            AS tat_samples
  FROM cases
 WHERE completed_at IS NOT NULL
 GROUP BY 1, 2, 3;
CREATE UNIQUE INDEX ON mv_cases_completed_daily (day, client_id, category);
CREATE INDEX        ON mv_cases_completed_daily (client_id, day);

-- migrate:down
DROP MATERIALIZED VIEW IF EXISTS mv_cases_completed_daily;
DROP MATERIALIZED VIEW IF EXISTS mv_cases_created_daily;

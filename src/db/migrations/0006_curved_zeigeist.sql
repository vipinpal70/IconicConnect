ALTER TABLE "cases" ADD COLUMN "timeline" jsonb DEFAULT '[]'::jsonb NOT NULL;

WITH timeline_rows AS (
  SELECT
    log.case_id,
    jsonb_agg(
      jsonb_build_object(
        'id', gen_random_uuid(),
        'action', log.action,
        'label',
          CASE
            WHEN log.action = 'case.created' THEN 'Case submitted by client'
            WHEN log.action = 'case.file_uploaded' THEN 'Case file uploaded'
            WHEN log.action = 'case.updated' THEN
              CASE coalesce(log.details -> 'changes' ->> 'status', '')
                WHEN 'scan_verified' THEN 'Scan validated'
                WHEN 'allocated_to_designer' THEN 'Allocated to designer'
                WHEN 'in_progress' THEN 'Allocated to designer'
                WHEN 'internal_qc' THEN 'Design submitted to internal QC'
                WHEN 'submitted_to_client' THEN 'Submitted for client approval'
                WHEN 'approved' THEN 'Client approved · Delivered'
                WHEN 'delivered' THEN 'Client approved · Delivered'
                WHEN 'client_feedback' THEN 'Client requested changes'
                WHEN 'on_hold' THEN 'Case put on hold'
                WHEN 'scan_not_verified' THEN 'Case put on hold'
                ELSE 'Case details updated'
              END
            ELSE replace(log.action, '.', ' ')
          END,
        'actor',
          CASE actor.role
            WHEN 'client' THEN coalesce(actor.lab_name, actor.full_name, 'Client')
            WHEN 'subuser' THEN coalesce(actor.full_name, 'Subuser')
            WHEN 'admin' THEN coalesce(actor.full_name, 'Super Admin')
            WHEN 'qc' THEN
              CASE
                WHEN actor.full_name IS NOT NULL AND actor.full_name <> '' THEN 'QC — ' || actor.full_name
                ELSE 'QC'
              END
            WHEN 'designer' THEN coalesce(actor.full_name, 'Designer')
            WHEN 'account_manager' THEN coalesce(actor.full_name, 'Account Manager')
            ELSE coalesce(actor.full_name, actor.lab_name, 'System')
          END,
        'actionAt', to_jsonb(log.action_at)
      )
      ORDER BY log.action_at
    ) AS timeline
  FROM "activity_logs" log
  LEFT JOIN "profiles" actor ON actor.id = log.user_id
  WHERE log.case_id IS NOT NULL
  GROUP BY log.case_id
)
UPDATE "cases"
SET "timeline" = timeline_rows.timeline
FROM timeline_rows
WHERE "cases"."id" = timeline_rows.case_id;

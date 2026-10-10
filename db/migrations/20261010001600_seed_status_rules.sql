-- Reference data the app logic depends on: status presentation/flow metadata and the per-role transition matrix.
-- Mirrors src/lib/case-status-mapping.ts and api/cases/[id]/route.ts. Runtime conditions that need row data
-- (e.g. canClientCancelCase, "designer has no designer yet") stay in the service layer; only static facts live here.

-- migrate:up
INSERT INTO case_status_meta (status, admin_label, client_label, lifecycle_step, step_order, is_finished, is_billable) VALUES
  ('scan_received',         'Scan Received',         'Case Submitted',   'Submitted',               1, false, false),
  ('scan_not_verified',     'Scan Rejected',         'In Validation',    'In Validation',           2, false, false),
  ('scan_verified',         'Scan Verified',         'Validated',        'In Validation',           2, false, false),
  ('on_hold',               'On Hold',               'On Hold',          'In Validation',           2, false, false),
  ('allocated_to_designer', 'Allocated to Designer', 'In Design',        'In Design',               3, false, false),
  ('in_progress',           'In Progress',           'In Design',        'In Design',               3, false, false),
  ('client_feedback',       'Client Feedback',       'Feedback',         'In Design',               3, false, false),
  ('internal_qc',           'Internal QC',           'Internal QC',      'Internal QC',             4, false, false),
  ('submitted_to_client',   'Submitted to Client',   'Client Review',    'Pending Client Approval', 5, false, false),
  ('change_requested',      'Change Requested',      'Change Requested', 'Pending Client Approval', 5, false, false),
  ('approved',              'Approved',              'Case Approved',    'Completed',               6, true,  true),
  ('delivered',             'Delivered',             'Completed',        'Completed',               6, true,  true),
  ('cancelled',             'Cancelled',             'Cancelled',        'Completed',               6, true,  false),
  ('client_reject',         'Rejected',              'Rejected',         'Completed',               6, true,  false);

WITH open_st AS (
  SELECT array_agg(status) AS s FROM case_status_meta WHERE NOT is_finished
)
INSERT INTO case_status_transitions (role, from_status, to_status, needs_assignment, needs_output_file, needs_qc_lead)
SELECT DISTINCT ro, f, t, na, nof, nql
FROM (
  SELECT r.roles, r.froms, r.tos, r.na, r.nof, r.nql FROM open_st, LATERAL (VALUES
    -- lab users
    (ARRAY['client','subuser']::user_role[], ARRAY['scan_received','scan_not_verified','scan_verified']::case_status[], ARRAY['on_hold']::case_status[],  false, false, false),
    (ARRAY['client','subuser']::user_role[], ARRAY['on_hold']::case_status[],                                          ARRAY['scan_received']::case_status[], false, false, false),
    (ARRAY['client','subuser']::user_role[], ARRAY['submitted_to_client']::case_status[],                              ARRAY['approved','change_requested','client_reject']::case_status[], false, false, false),
    (ARRAY['client','subuser']::user_role[], open_st.s,                                                                ARRAY['cancelled']::case_status[], false, false, false),
    -- designer
    (ARRAY['designer']::user_role[], ARRAY['scan_received']::case_status[],                                            ARRAY['scan_verified']::case_status[], false, false, false),
    (ARRAY['designer']::user_role[], ARRAY['allocated_to_designer','scan_verified','client_feedback']::case_status[],  ARRAY['in_progress']::case_status[],   true,  false, false),
    (ARRAY['designer']::user_role[], ARRAY['in_progress']::case_status[],                                              ARRAY['internal_qc']::case_status[],   true,  true,  true),
    (ARRAY['designer']::user_role[], ARRAY['internal_qc']::case_status[],                                              ARRAY['in_progress']::case_status[],   true,  false, false),
    (ARRAY['designer']::user_role[], ARRAY['submitted_to_client']::case_status[],                                      ARRAY['internal_qc']::case_status[],   true,  false, false),
    (ARRAY['designer']::user_role[], open_st.s,                                                                        ARRAY['on_hold']::case_status[],       false, false, false),
    (ARRAY['designer']::user_role[], ARRAY['on_hold']::case_status[],                                                  ARRAY['scan_received']::case_status[], true,  false, false),
    -- qc
    (ARRAY['qc']::user_role[], ARRAY['scan_received','scan_verified','scan_not_verified','client_feedback','client_reject']::case_status[], ARRAY['in_progress']::case_status[], false, false, false),
    (ARRAY['qc']::user_role[], ARRAY['in_progress']::case_status[],                                                    ARRAY['internal_qc']::case_status[],   true,  true,  true),
    (ARRAY['qc']::user_role[], ARRAY['internal_qc']::case_status[],                                                    ARRAY['submitted_to_client','client_feedback']::case_status[], true, false, false),
    (ARRAY['qc']::user_role[], ARRAY['change_requested']::case_status[],                                               ARRAY['client_feedback','submitted_to_client']::case_status[], true, false, false),
    (ARRAY['qc']::user_role[], ARRAY['submitted_to_client']::case_status[],                                            ARRAY['internal_qc']::case_status[],   true,  false, false),
    (ARRAY['qc']::user_role[], open_st.s,                                                                              ARRAY['on_hold']::case_status[],       false, false, false),
    (ARRAY['qc']::user_role[], ARRAY['on_hold']::case_status[],                                                        ARRAY['scan_received']::case_status[], true,  false, false)
  ) AS r(roles, froms, tos, na, nof, nql)
) x, unnest(roles) ro, unnest(froms) f, unnest(tos) t;

-- admin: any status -> any other status; moving into internal_qc still needs a design output file.
INSERT INTO case_status_transitions (role, from_status, to_status, needs_output_file)
SELECT 'admin', a.status, b.status, b.status = 'internal_qc'
FROM case_status_meta a CROSS JOIN case_status_meta b WHERE a.status <> b.status;
-- account_manager: intentionally no rows (read-only).

-- migrate:down
DELETE FROM case_status_transitions;
DELETE FROM case_status_meta;

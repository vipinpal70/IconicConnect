-- updated_at triggers and cases_before_write (search_text, promoted columns, row_version).

-- migrate:up
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_users_updated     BEFORE UPDATE ON users                 FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_profiles_updated  BEFORE UPDATE ON profiles              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_catalog_updated   BEFORE UPDATE ON service_catalog       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_cpl_updated       BEFORE UPDATE ON client_price_list     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_cases_updated     BEFORE UPDATE ON cases                 FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_details_updated   BEFORE UPDATE ON case_details          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tickets_updated   BEFORE UPDATE ON support_tickets       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_forms_updated     BEFORE UPDATE ON preference_forms      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_invoices_updated  BEFORE UPDATE ON invoices              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_offers_updated    BEFORE UPDATE ON offers                FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tutorials_updated BEFORE UPDATE ON tutorials             FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Keep the promoted columns, search_text and row_version consistent no matter which service writes the row.
CREATE FUNCTION cases_before_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.case_type := COALESCE(NEW.sub_type_data->>'caseType', NEW.sub_type_data->>'caseType1', NEW.case_type);
  IF jsonb_typeof(NEW.sub_type_data->'teeth') = 'array' THEN
    NEW.teeth := ARRAY(SELECT jsonb_array_elements_text(NEW.sub_type_data->'teeth')::smallint);
  END IF;
  NEW.search_text := lower(concat_ws(' ',
      NEW.case_number, NEW.category, NEW.case_type,
      (SELECT string_agg(e.value, ' ') FROM jsonb_each_text(NEW.sub_type_data) e
        WHERE jsonb_typeof(NEW.sub_type_data -> e.key) = 'string')));
  IF TG_OP = 'UPDATE' THEN NEW.row_version := OLD.row_version + 1; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_cases_write BEFORE INSERT OR UPDATE ON cases FOR EACH ROW EXECUTE FUNCTION cases_before_write();

-- migrate:down
DROP TRIGGER IF EXISTS trg_cases_write ON cases;
DROP TRIGGER IF EXISTS trg_tutorials_updated ON tutorials;
DROP TRIGGER IF EXISTS trg_offers_updated ON offers;
DROP TRIGGER IF EXISTS trg_invoices_updated ON invoices;
DROP TRIGGER IF EXISTS trg_forms_updated ON preference_forms;
DROP TRIGGER IF EXISTS trg_tickets_updated ON support_tickets;
DROP TRIGGER IF EXISTS trg_details_updated ON case_details;
DROP TRIGGER IF EXISTS trg_cases_updated ON cases;
DROP TRIGGER IF EXISTS trg_cpl_updated ON client_price_list;
DROP TRIGGER IF EXISTS trg_catalog_updated ON service_catalog;
DROP TRIGGER IF EXISTS trg_profiles_updated ON profiles;
DROP TRIGGER IF EXISTS trg_users_updated ON users;
DROP FUNCTION IF EXISTS cases_before_write();
DROP FUNCTION IF EXISTS set_updated_at();

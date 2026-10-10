-- users (credentials), profiles (business identity + effective client_id), auth_audit_log.

-- migrate:up
-- A1. Credentials only. Hot, tiny, touched by the auth service.
CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext NOT NULL UNIQUE,                 -- single source of truth for email
  password_hash       text   NOT NULL,                        -- argon2id ($argon2id$…); legacy bcrypt ($2…) allowed until first login, then re-hashed
  email_verified_at   timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  last_login_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- A2. Business identity, 1:1 with users.
CREATE TABLE profiles (
  id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  user_type     user_type   NOT NULL,
  user_role     user_role   NOT NULL,
  user_status   user_status NOT NULL DEFAULT 'pending',
  plan_status   plan_status,                                   -- lab_portal only
  -- effective lab: client -> itself, subuser -> parent client, staff -> NULL
  client_id     uuid REFERENCES profiles(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,  -- who created this sub-user / staff member
  full_name     varchar(150),
  title         varchar(100),                                  -- sub-user sub-role: Owner/Manager/Coordinator/Technician
  phone         varchar(30),
  lab_name      varchar(150),
  postal_code   varchar(20),
  city          varchar(100),
  state         varchar(100),
  country       varchar(100),
  onboarded_at  timestamptz,
  deleted_at    timestamptz,                                   -- soft delete; hard delete is done by the explicit delete-client service
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT profiles_type_role_ck CHECK (
       (user_type = 'lab_portal'   AND user_role IN ('client','subuser'))
    OR (user_type = 'admin_portal' AND user_role IN ('admin','qc','account_manager','designer'))
  ),
  CONSTRAINT profiles_client_id_ck CHECK (
       (user_role = 'client'  AND client_id = id)
    OR (user_role = 'subuser' AND client_id IS NOT NULL AND client_id <> id)
    OR (user_type = 'admin_portal' AND client_id IS NULL)
  ),
  CONSTRAINT profiles_plan_ck CHECK (plan_status IS NULL OR user_type = 'lab_portal')
);

-- A3. Security audit trail (sign-in, lockout, reset, role change). Append-only.
CREATE TABLE auth_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  email       citext,
  event       text NOT NULL,            -- signin_ok | signin_fail | locked | signout | pw_reset_requested | pw_reset_done | role_changed …
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE IF EXISTS auth_audit_log;
DROP TABLE IF EXISTS profiles;
DROP TABLE IF EXISTS users;

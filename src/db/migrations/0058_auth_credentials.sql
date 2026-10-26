CREATE TABLE IF NOT EXISTS "auth_credentials" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "email" varchar(255),
  "phone" varchar(32),
  "password_hash" text,
  "email_verified_at" timestamp,
  "phone_verified_at" timestamp,
  "banned_until" timestamp,
  "deleted_at" timestamp,
  "user_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "app_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "password_changed_at" timestamp DEFAULT now() NOT NULL,
  "last_login_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "auth_credentials_email_unique"
  ON "auth_credentials" (lower("email"))
  WHERE "email" IS NOT NULL;
ALTER TABLE "auth_credentials" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "auth_credentials" FROM anon, authenticated;

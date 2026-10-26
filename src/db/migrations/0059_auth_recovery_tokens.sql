CREATE TABLE "auth_recovery_tokens" (
  "token_hash" varchar(64) PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "auth_recovery_tokens_user_id_idx"
  ON "auth_recovery_tokens" ("user_id");
ALTER TABLE "auth_recovery_tokens" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "auth_recovery_tokens" FROM anon, authenticated;

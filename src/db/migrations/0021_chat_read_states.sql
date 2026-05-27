CREATE TABLE "chat_read_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_read_states" ADD CONSTRAINT "chat_read_states_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_read_states" ADD CONSTRAINT "chat_read_states_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_read_states_case_user_idx" ON "chat_read_states" USING btree ("case_id","user_id");
--> statement-breakpoint
CREATE INDEX "chat_read_states_user_idx" ON "chat_read_states" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_case_id_idx" ON "chat_messages" USING btree ("case_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_case_created_at_idx" ON "chat_messages" USING btree ("case_id","created_at");
--> statement-breakpoint
INSERT INTO "chat_read_states" ("case_id", "user_id", "last_read_at", "created_at", "updated_at")
SELECT "case_participants"."case_id", "case_participants"."user_id", now(), now(), now()
FROM (
	SELECT "cases"."id" AS "case_id", "cases"."client_id" AS "user_id" FROM "cases"
	UNION
	SELECT "cases"."id" AS "case_id", "cases"."subuser_id" AS "user_id" FROM "cases" WHERE "cases"."subuser_id" IS NOT NULL
	UNION
	SELECT "cases"."id" AS "case_id", "cases"."designer_id" AS "user_id" FROM "cases" WHERE "cases"."designer_id" IS NOT NULL
	UNION
	SELECT "cases"."id" AS "case_id", "cases"."qc_id" AS "user_id" FROM "cases" WHERE "cases"."qc_id" IS NOT NULL
	UNION
	SELECT "cases"."id" AS "case_id", "cases"."account_manager_id" AS "user_id" FROM "cases" WHERE "cases"."account_manager_id" IS NOT NULL
) AS "case_participants"
WHERE EXISTS (
	SELECT 1 FROM "chat_messages" WHERE "chat_messages"."case_id" = "case_participants"."case_id"
)
ON CONFLICT ("case_id", "user_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "chat_read_states" ("case_id", "user_id", "last_read_at", "created_at", "updated_at")
SELECT "cases"."id", "profiles"."id", now(), now(), now()
FROM "cases"
CROSS JOIN "profiles"
WHERE "profiles"."user_role" = 'admin'
	AND "profiles"."user_status" = 'active'
	AND EXISTS (
		SELECT 1 FROM "chat_messages" WHERE "chat_messages"."case_id" = "cases"."id"
	)
ON CONFLICT ("case_id", "user_id") DO NOTHING;

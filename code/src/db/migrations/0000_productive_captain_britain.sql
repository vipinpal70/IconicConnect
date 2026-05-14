CREATE TYPE "public"."plan_status" AS ENUM('Trial', 'Onboarded');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('client', 'subuser', 'admin', 'qc', 'account_manager', 'designer');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."user_type" AS ENUM('lab_portal', 'admin_portal');--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_type" "user_type" NOT NULL,
	"user_role" "user_role" NOT NULL,
	"user_status" "user_status" DEFAULT 'pending' NOT NULL,
	"plan_status" "plan_status" DEFAULT 'Trial',
	"full_name" varchar(100),
	"title" varchar(50),
	"email" varchar(255) NOT NULL,
	"phone" varchar(20),
	"lab_name" varchar(150),
	"postal_code" varchar(20),
	"city" varchar(100),
	"state" varchar(100),
	"country" varchar(100),
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"onboarded_at" timestamp,
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sub_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sub_users" ADD CONSTRAINT "sub_users_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_users" ADD CONSTRAINT "sub_users_client_id_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
-- Add start_time (when designer clicks Start Work → in_progress)
-- and delivered_time (when client approves the case → approved)
ALTER TABLE "cases" ADD COLUMN "start_time" TIMESTAMP;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "delivered_time" TIMESTAMP;

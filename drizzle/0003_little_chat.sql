CREATE TABLE "poll_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"raison" text,
	"recus" integer DEFAULT 0 NOT NULL,
	"ecrits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "poll_runs_date" ON "poll_runs" USING btree ("ran_at");
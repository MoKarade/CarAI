CREATE TABLE "app_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"service_date" timestamp with time zone NOT NULL,
	"odometer_at_service" double precision,
	"odometer_unit" text,
	"tasks" jsonb,
	"service_type" text,
	"total_cost" double precision,
	"currency" text,
	"raw" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_commands_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"command_type" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"issued_by" text,
	"params" jsonb,
	"message" text,
	"raw_response" jsonb
);
--> statement-breakpoint
CREATE TABLE "vehicle_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"metric_type" text NOT NULL,
	"signal_code" text,
	"value_numeric" double precision,
	"value_text" text,
	"value_json" jsonb,
	"unit" text,
	"location_type" text
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshots_written" integer DEFAULT 0 NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE INDEX "otp_codes_date" ON "otp_codes" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_history_dedupe_unique" ON "service_history" USING btree ("source","dedupe_key");--> statement-breakpoint
CREATE INDEX "service_history_date" ON "service_history" USING btree ("service_date");--> statement-breakpoint
CREATE INDEX "vehicle_commands_log_date" ON "vehicle_commands_log" USING btree ("issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_snapshots_mesure_unique" ON "vehicle_snapshots" USING btree ("source","metric_type","recorded_at");--> statement-breakpoint
CREATE INDEX "vehicle_snapshots_metric_date" ON "vehicle_snapshots" USING btree ("metric_type","recorded_at");--> statement-breakpoint
CREATE INDEX "vehicle_snapshots_date" ON "vehicle_snapshots" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_date" ON "webhook_deliveries" USING btree ("received_at");
CREATE TABLE "geocode_cache" (
	"cle" text PRIMARY KEY NOT NULL,
	"libelle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

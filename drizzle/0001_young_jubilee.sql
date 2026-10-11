ALTER TABLE "users" ADD COLUMN "nickname" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" varchar(2000);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "creditBalance" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "loginCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birthDate" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lastSeenAt" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "isActive" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "createdAt" timestamp DEFAULT now() NOT NULL;
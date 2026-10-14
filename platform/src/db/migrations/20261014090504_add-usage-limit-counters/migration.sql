CREATE TABLE "usage_limit_counter" (
	"organization_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"usage_limit_id" uuid NOT NULL,
	"tenant_id" uuid,
	"tenant_user_id" uuid,
	"thread_id" uuid,
	"window_ends_at" timestamp with time zone NOT NULL,
	"tokens" bigint NOT NULL,
	"spend" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_limit_counter_pkey" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "usage_limit_counter_subject_key" UNIQUE NULLS NOT DISTINCT("organization_id","usage_limit_id","tenant_id","tenant_user_id","thread_id"),
	CONSTRAINT "usage_limit_counter_subject_check" CHECK (("tenant_id" is not null or ("tenant_user_id" is null and "thread_id" is null)) and ("tenant_user_id" is null or "thread_id" is null))
);
--> statement-breakpoint
ALTER TABLE "usage_limit_counter" ADD CONSTRAINT "usage_limit_counter_usage_limit_fk" FOREIGN KEY ("organization_id","usage_limit_id") REFERENCES "usage_limit"("organization_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "usage_limit_counter" ADD CONSTRAINT "usage_limit_counter_tenant_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "tenant"("organization_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "usage_limit_counter" ADD CONSTRAINT "usage_limit_counter_tenant_user_fk" FOREIGN KEY ("organization_id","tenant_id","tenant_user_id") REFERENCES "tenant_user"("organization_id","tenant_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "usage_limit_counter" ADD CONSTRAINT "usage_limit_counter_thread_fk" FOREIGN KEY ("organization_id","tenant_id","thread_id") REFERENCES "chat_thread"("organization_id","tenant_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
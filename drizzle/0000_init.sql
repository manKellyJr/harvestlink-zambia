CREATE TYPE "public"."lot_status" AS ENUM('listed', 'sold_out', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('allocated', 'assigned', 'picked_up', 'delivered', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payee_type" AS ENUM('farmer', 'transporter');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('owed', 'buyer_marked_paid', 'confirmed', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('farmer', 'buyer', 'transporter', 'admin');--> statement-breakpoint
CREATE TYPE "public"."wallet_provider" AS ENUM('mtn', 'airtel', 'zamtel');--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"lot_id" integer NOT NULL,
	"quantity_kg" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" integer NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"district" text NOT NULL,
	"province" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" serial PRIMARY KEY NOT NULL,
	"farmer_id" integer NOT NULL,
	"collection_point_id" integer NOT NULL,
	"crop" text NOT NULL,
	"quantity_kg" integer NOT NULL,
	"available_kg" integer NOT NULL,
	"min_price_per_kg_ngwee" integer NOT NULL,
	"status" "lot_status" DEFAULT 'listed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"buyer_id" integer NOT NULL,
	"collection_point_id" integer NOT NULL,
	"crop" text NOT NULL,
	"quantity_kg" integer NOT NULL,
	"price_per_kg_ngwee" integer NOT NULL,
	"transport_fee_ngwee" integer NOT NULL,
	"delivery_address" text NOT NULL,
	"transporter_id" integer,
	"status" "order_status" DEFAULT 'allocated' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"payee_id" integer NOT NULL,
	"payee_type" "payee_type" NOT NULL,
	"amount_ngwee" integer NOT NULL,
	"wallet_provider" "wallet_provider" NOT NULL,
	"wallet_phone" text NOT NULL,
	"status" "payout_status" DEFAULT 'owed' NOT NULL,
	"buyer_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"role" "role" NOT NULL,
	"district" text,
	"wallet_provider" "wallet_provider",
	"consent_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_farmer_id_users_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_collection_point_id_collection_points_id_fk" FOREIGN KEY ("collection_point_id") REFERENCES "public"."collection_points"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_collection_point_id_collection_points_id_fk" FOREIGN KEY ("collection_point_id") REFERENCES "public"."collection_points"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_transporter_id_users_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_payee_id_users_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocations_order_idx" ON "allocations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "lots_matching_idx" ON "lots" USING btree ("collection_point_id","crop","status");--> statement-breakpoint
CREATE INDEX "payouts_payee_idx" ON "payouts" USING btree ("payee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_idx" ON "users" USING btree ("phone");
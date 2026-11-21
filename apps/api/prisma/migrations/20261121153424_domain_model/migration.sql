-- C1.2: the domain model. `users` gains required columns without defaults; nothing is deployed yet,
-- and the C0.5 placeholder table only ever held test rows.
-- CreateEnum
CREATE TYPE "role" AS ENUM ('CUSTOMER', 'ADMIN');

-- CreateEnum
CREATE TYPE "event_category" AS ENUM ('CONCERT', 'TALK', 'MEETUP');

-- CreateEnum
CREATE TYPE "event_status" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "section_type" AS ENUM ('SEATED', 'GA');

-- CreateEnum
CREATE TYPE "inventory_status" AS ENUM ('AVAILABLE', 'HELD', 'SOLD');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PENDING_PAYMENT', 'PROCESSING', 'CONFIRMED', 'FAILED', 'EXPIRED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "created_at" TIMESTAMPTZ(3) NOT NULL,
ADD COLUMN     "email_verified_at" TIMESTAMPTZ(3),
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "password_hash" TEXT NOT NULL,
ADD COLUMN     "role" "role" NOT NULL DEFAULT 'CUSTOMER',
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL;

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venues" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL,
    "venue_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "section_type" NOT NULL,
    "capacity" INTEGER,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seats" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "row" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,

    CONSTRAINT "seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "performer" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "event_category" NOT NULL,
    "status" "event_status" NOT NULL DEFAULT 'DRAFT',
    "venue_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "sales_open_at" TIMESTAMPTZ(3) NOT NULL,
    "hold_duration_sec" INTEGER NOT NULL DEFAULT 600,
    "max_tickets_per_order" INTEGER NOT NULL DEFAULT 6,
    "waiting_room_enabled" BOOLEAN NOT NULL DEFAULT false,
    "admission_rate_per_sec" INTEGER NOT NULL DEFAULT 10,
    "admission_token_ttl_sec" INTEGER NOT NULL DEFAULT 600,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_batches" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "releases_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ticket_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_units" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "seat_id" UUID,
    "batch_id" UUID NOT NULL,
    "status" "inventory_status" NOT NULL DEFAULT 'AVAILABLE',
    "price_cents" INTEGER NOT NULL,
    "hold_id" UUID,
    "held_until" TIMESTAMPTZ(3),

    CONSTRAINT "inventory_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holds" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "total_cents" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "payment_session_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "inventory_unit_id" UUID NOT NULL,
    "price_cents" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "order_id" UUID,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "venues_slug_key" ON "venues"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "sections_venue_id_name_key" ON "sections"("venue_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sections_venue_id_sort_order_key" ON "sections"("venue_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "seats_section_id_row_number_key" ON "seats"("section_id", "row", "number");

-- CreateIndex
CREATE UNIQUE INDEX "seats_section_id_row_index_number_key" ON "seats"("section_id", "row_index", "number");

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE INDEX "events_status_starts_at_id_idx" ON "events"("status", "starts_at", "id");

-- CreateIndex
CREATE INDEX "events_venue_id_starts_at_idx" ON "events"("venue_id", "starts_at");

-- CreateIndex
CREATE INDEX "ticket_batches_event_id_releases_at_idx" ON "ticket_batches"("event_id", "releases_at");

-- CreateIndex
CREATE INDEX "inventory_units_event_id_section_id_status_idx" ON "inventory_units"("event_id", "section_id", "status");

-- CreateIndex
CREATE INDEX "inventory_units_hold_id_idx" ON "inventory_units"("hold_id");

-- CreateIndex
CREATE INDEX "inventory_units_batch_id_idx" ON "inventory_units"("batch_id");

-- CreateIndex
CREATE INDEX "inventory_units_status_held_until_idx" ON "inventory_units"("status", "held_until");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_units_event_id_seat_id_key" ON "inventory_units"("event_id", "seat_id");

-- CreateIndex
CREATE INDEX "holds_user_id_idx" ON "holds"("user_id");

-- CreateIndex
CREATE INDEX "holds_expires_at_idx" ON "holds"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "holds_event_id_user_id_key" ON "holds"("event_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_payment_session_id_key" ON "orders"("payment_session_id");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_id_idx" ON "orders"("user_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "orders_status_expires_at_idx" ON "orders"("status", "expires_at");

-- CreateIndex
CREATE INDEX "order_items_inventory_unit_id_idx" ON "order_items"("inventory_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_inventory_unit_id_key" ON "order_items"("order_id", "inventory_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_order_item_id_key" ON "tickets"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_code_key" ON "tickets"("code");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_event_id_key" ON "payment_events"("provider_event_id");

-- CreateIndex
CREATE INDEX "payment_events_order_id_idx" ON "payment_events"("order_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seats" ADD CONSTRAINT "seats_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_batches" ADD CONSTRAINT "ticket_batches_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "ticket_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "holds"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holds" ADD CONSTRAINT "holds_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holds" ADD CONSTRAINT "holds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_inventory_unit_id_fkey" FOREIGN KEY ("inventory_unit_id") REFERENCES "inventory_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECK constraints (hand-written: Prisma's schema can't express them, and Migrate leaves them alone).

ALTER TABLE "users" ADD CONSTRAINT "users_email_lower_check" CHECK ("email" = lower("email"));

ALTER TABLE "sections"
  ADD CONSTRAINT "sections_capacity_check" CHECK (("type" = 'GA') = ("capacity" IS NOT NULL) AND ("capacity" IS NULL OR "capacity" > 0));

ALTER TABLE "seats"
  ADD CONSTRAINT "seats_row_index_check" CHECK ("row_index" >= 0),
  ADD CONSTRAINT "seats_number_check" CHECK ("number" > 0);

ALTER TABLE "events"
  ADD CONSTRAINT "events_ends_after_start_check" CHECK ("ends_at" > "starts_at"),
  ADD CONSTRAINT "events_hold_duration_sec_check" CHECK ("hold_duration_sec" > 0),
  ADD CONSTRAINT "events_max_tickets_per_order_check" CHECK ("max_tickets_per_order" > 0),
  ADD CONSTRAINT "events_admission_rate_per_sec_check" CHECK ("admission_rate_per_sec" > 0),
  ADD CONSTRAINT "events_admission_token_ttl_sec_check" CHECK ("admission_token_ttl_sec" > 0);

ALTER TABLE "ticket_batches" ADD CONSTRAINT "ticket_batches_price_cents_check" CHECK ("price_cents" >= 0);

-- A unit is HELD exactly when it has a hold, and has a hold exactly when it has an expiry.
ALTER TABLE "inventory_units"
  ADD CONSTRAINT "inventory_units_price_cents_check" CHECK ("price_cents" >= 0),
  ADD CONSTRAINT "inventory_units_hold_check" CHECK (
    ("status" = 'HELD') = ("hold_id" IS NOT NULL) AND ("hold_id" IS NULL) = ("held_until" IS NULL)
  );

ALTER TABLE "orders" ADD CONSTRAINT "orders_total_cents_check" CHECK ("total_cents" >= 0);

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_price_cents_check" CHECK ("price_cents" >= 0);

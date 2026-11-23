-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "tickets_emailed_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "orders_status_tickets_emailed_at_updated_at_idx" ON "orders"("status", "tickets_emailed_at", "updated_at");

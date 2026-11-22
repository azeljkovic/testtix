-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "hold_id" UUID,
ADD COLUMN     "payment_url" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_hold_id_key" ON "orders"("hold_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "holds"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CHECK constraint (hand-written: Prisma's schema can't express it, and Migrate leaves it alone).
-- The payment session and its page URL are stored together.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_payment_session_check" CHECK (("payment_session_id" IS NULL) = ("payment_url" IS NULL));

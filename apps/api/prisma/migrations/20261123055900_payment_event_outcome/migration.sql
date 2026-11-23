-- `payment_events` is empty until C4.3 receives webhooks, so the new column needs no default.
-- CreateEnum
CREATE TYPE "payment_event_outcome" AS ENUM ('APPLIED', 'IGNORED', 'REFUND_DUE');

-- AlterTable
ALTER TABLE "payment_events" ADD COLUMN     "outcome" "payment_event_outcome" NOT NULL;

-- CreateIndex
CREATE INDEX "payment_events_outcome_received_at_idx" ON "payment_events"("outcome", "received_at");

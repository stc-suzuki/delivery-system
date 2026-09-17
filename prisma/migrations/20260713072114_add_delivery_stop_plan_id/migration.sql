-- DropForeignKey
ALTER TABLE "DeliveryStop" DROP CONSTRAINT "DeliveryStop_routeId_fkey";

-- AlterTable: add planId as nullable first, and make routeId nullable
ALTER TABLE "DeliveryStop" ADD COLUMN     "planId" TEXT,
ALTER COLUMN "routeId" DROP NOT NULL;

-- Backfill: every existing DeliveryStop currently has a non-null routeId,
-- and every PlanRoute.planId is required, so this backfills 100% of existing rows.
UPDATE "DeliveryStop" ds
SET "planId" = pr."planId"
FROM "PlanRoute" pr
WHERE pr.id = ds."routeId";

-- Now safe to require it
ALTER TABLE "DeliveryStop" ALTER COLUMN "planId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "DeliveryStop_planId_idx" ON "DeliveryStop"("planId");

-- CreateIndex
CREATE INDEX "DeliveryStop_routeId_idx" ON "DeliveryStop"("routeId");

-- AddForeignKey
ALTER TABLE "DeliveryStop" ADD CONSTRAINT "DeliveryStop_planId_fkey" FOREIGN KEY ("planId") REFERENCES "DeliveryPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryStop" ADD CONSTRAINT "DeliveryStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "PlanRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

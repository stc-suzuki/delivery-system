-- AlterTable
ALTER TABLE "PlanRoute" ADD COLUMN "startedByDispatcher" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlanRoute" ADD COLUMN "returnedByDispatcher" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DeliveryStop" ADD COLUMN "statusSetByDispatcher" BOOLEAN NOT NULL DEFAULT false;

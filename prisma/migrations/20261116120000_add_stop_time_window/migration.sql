-- AlterTable
ALTER TABLE "DeliveryStop" ADD COLUMN     "requestedWindowEnd" TIMESTAMP(3),
ADD COLUMN     "requestedWindowStart" TIMESTAMP(3);

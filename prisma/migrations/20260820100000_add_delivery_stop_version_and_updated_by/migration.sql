-- AlterTable
ALTER TABLE "DeliveryStop" ADD COLUMN     "updatedByName" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

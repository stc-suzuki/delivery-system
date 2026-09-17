-- AlterTable
ALTER TABLE "DeliveryStop" DROP COLUMN "volumeM3";

-- AlterTable
ALTER TABLE "Truck" ADD COLUMN     "bedDepth" DOUBLE PRECISION,
ADD COLUMN     "bedHeight" DOUBLE PRECISION,
ADD COLUMN     "bedWidth" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "depth" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "DeliveryStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;


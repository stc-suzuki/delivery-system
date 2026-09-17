-- AlterTable
ALTER TABLE "FuelLog" ADD COLUMN     "tripId" TEXT;

-- AlterTable
ALTER TABLE "TrackingLog" ADD COLUMN     "tripId" TEXT;

-- AddForeignKey
ALTER TABLE "TrackingLog" ADD CONSTRAINT "TrackingLog_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "RouteTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "RouteTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

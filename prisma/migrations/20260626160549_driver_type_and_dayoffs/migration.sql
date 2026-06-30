-- Recreate DriverType enum with FIXED_ROUTE / REGULAR / SALES (replaces REGULAR / SPOT)
ALTER TABLE "Driver" ALTER COLUMN "type" TYPE TEXT;
UPDATE "Driver" SET "type" = 'SALES' WHERE "type" = 'SPOT';
DROP TYPE "DriverType";
CREATE TYPE "DriverType" AS ENUM ('FIXED_ROUTE', 'REGULAR', 'SALES');
ALTER TABLE "Driver" ALTER COLUMN "type" TYPE "DriverType" USING "type"::"DriverType";

-- SpotAvailability (spot-driver working days) is replaced by DriverDayOff (manual off-days for any
-- driver type); the semantics are inverted, so existing rows are dropped rather than carried over.
DELETE FROM "SpotAvailability";
ALTER TABLE "SpotAvailability" RENAME TO "DriverDayOff";
ALTER TABLE "DriverDayOff" RENAME CONSTRAINT "SpotAvailability_pkey" TO "DriverDayOff_pkey";
ALTER TABLE "DriverDayOff" RENAME CONSTRAINT "SpotAvailability_driverId_fkey" TO "DriverDayOff_driverId_fkey";
ALTER INDEX "SpotAvailability_driverId_date_key" RENAME TO "DriverDayOff_driverId_date_key";

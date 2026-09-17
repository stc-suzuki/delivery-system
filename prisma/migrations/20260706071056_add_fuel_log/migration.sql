-- CreateTable
CREATE TABLE "FuelLog" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "PlanRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

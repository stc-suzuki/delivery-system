-- AlterTable
ALTER TABLE "DeliveryStop" ADD COLUMN     "tripId" TEXT;

-- CreateTable
CREATE TABLE "RouteTrip" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "tripIndex" INTEGER NOT NULL,
    "departureTime" TIMESTAMP(3),
    "status" "RouteStatus" NOT NULL DEFAULT 'PENDING',
    "returnedAt" TIMESTAMP(3),
    "startedByDispatcher" BOOLEAN NOT NULL DEFAULT false,
    "returnedByDispatcher" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteTrip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RouteTrip_routeId_tripIndex_key" ON "RouteTrip"("routeId", "tripIndex");

-- CreateIndex
CREATE INDEX "DeliveryStop_tripId_idx" ON "DeliveryStop"("tripId");

-- AddForeignKey
ALTER TABLE "RouteTrip" ADD CONSTRAINT "RouteTrip_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "PlanRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryStop" ADD CONSTRAINT "DeliveryStop_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "RouteTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

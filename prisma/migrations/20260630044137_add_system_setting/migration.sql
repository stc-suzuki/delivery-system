-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "defaultDepartureTime" TEXT NOT NULL DEFAULT '08:00',
    "lunchBreakStart" TEXT NOT NULL DEFAULT '12:00',
    "lunchBreakEnd" TEXT NOT NULL DEFAULT '13:00',
    "defaultStopDurationMinutes" INTEGER NOT NULL DEFAULT 10,
    "defaultCargoRatio" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

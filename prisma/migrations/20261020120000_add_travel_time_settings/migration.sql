-- 移動時間の見積もりの補正（平均時速・回り道係数・1区間ごとの固定時間）
ALTER TABLE "SystemSetting" ADD COLUMN "averageSpeedKmh" INTEGER NOT NULL DEFAULT 45,
ADD COLUMN "roadDetourFactor" DOUBLE PRECISION NOT NULL DEFAULT 1.1,
ADD COLUMN "perLegTravelMinutes" INTEGER NOT NULL DEFAULT 8;

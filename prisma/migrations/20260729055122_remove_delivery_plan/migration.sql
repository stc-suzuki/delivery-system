-- DeliveryPlan（複数トラックをまとめる「配送計画」）を廃止し、PlanRoute（トラック1台の配送ルート）を
-- このシステムの単一の管理単位にする。配送計画一覧・ダッシュボードでプラン単位とルート単位の集計が
-- 食い違って分かりにくかったため（2026-07-29に決定）。

-- 1. PlanRouteに移行先カラムを追加
ALTER TABLE "PlanRoute" ADD COLUMN "routeDate" DATE;
ALTER TABLE "PlanRoute" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "PlanRoute" ADD COLUMN "note" TEXT;
ALTER TABLE "PlanRoute" ADD COLUMN "createdBy" TEXT;

-- 2. 既存データをDeliveryPlanからバックフィル
--    confirmedAtは正確な確定日時を記録していなかったため、DRAFT以外はupdatedAtで代用する
UPDATE "PlanRoute" r
SET
  "routeDate" = p."planDate",
  "confirmedAt" = CASE WHEN p."status" <> 'DRAFT' THEN p."updatedAt" ELSE NULL END,
  "note" = p."note",
  "createdBy" = p."createdBy"
FROM "DeliveryPlan" p
WHERE r."planId" = p."id";

-- 3. NOT NULL制約を付与
ALTER TABLE "PlanRoute" ALTER COLUMN "routeDate" SET NOT NULL;
ALTER TABLE "PlanRoute" ALTER COLUMN "createdBy" SET NOT NULL;

-- 4. PlanRoute.planIdを削除
ALTER TABLE "PlanRoute" DROP CONSTRAINT "PlanRoute_planId_fkey";
ALTER TABLE "PlanRoute" DROP COLUMN "planId";

-- 5. DeliveryStop.planIdを削除（routeIdだけで十分なため）
ALTER TABLE "DeliveryStop" DROP CONSTRAINT "DeliveryStop_planId_fkey";
DROP INDEX "DeliveryStop_planId_idx";
ALTER TABLE "DeliveryStop" DROP COLUMN "planId";

-- 6. DeliveryPlanテーブル・PlanStatus enumを削除
DROP TABLE "DeliveryPlan";
DROP TYPE "PlanStatus";

-- 7. routeDateにインデックスを追加（日付指定の一覧取得で使用）
CREATE INDEX "PlanRoute_routeDate_idx" ON "PlanRoute"("routeDate");

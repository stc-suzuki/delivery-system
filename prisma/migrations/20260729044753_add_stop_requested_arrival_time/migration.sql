-- AlterTable
ALTER TABLE "DeliveryStop" ADD COLUMN "requestedArrivalTime" TIMESTAMP(3);

-- Backfill: 既存の時刻指定停車地は、現時点のscheduledTimeを到着希望時刻の初期値とみなす
-- （運用開始後にreorderRouteで既にずれている可能性はあるが、フィールド新設前のデータなのでベストエフォート）
UPDATE "DeliveryStop" SET "requestedArrivalTime" = "scheduledTime" WHERE "isTimeFixed" = true;

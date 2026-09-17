/*
  プールをDeliveryPlanから独立させるマイグレーション。
  1. stopDateを一旦nullableで追加
  2. 既存行のstopDateを、紐づくDeliveryPlan.planDateからバックフィル
  3. planIdを任意（nullable）に変更（先にNOT NULL制約を外す）
  4. 既存の「プール中」停車地（routeId未設定）はplanIdをnullに切り離す
     （新モデルでは未割当はプラン非依存のため）
  5. stopDateをNOT NULLに変更
*/

-- Step 1: stopDateを一旦nullableで追加
ALTER TABLE "DeliveryStop" ADD COLUMN "stopDate" DATE;

-- Step 2: 既存行のstopDateをバックフィル
UPDATE "DeliveryStop" ds
SET "stopDate" = dp."planDate"
FROM "DeliveryPlan" dp
WHERE ds."planId" = dp."id";

-- Step 3: planIdを任意に変更
-- DropForeignKey
ALTER TABLE "DeliveryStop" DROP CONSTRAINT "DeliveryStop_planId_fkey";

-- AlterTable
ALTER TABLE "DeliveryStop" ALTER COLUMN "planId" DROP NOT NULL;

-- Step 4: 未割当（プール中）の既存停車地をplanIdから切り離す
UPDATE "DeliveryStop"
SET "planId" = NULL
WHERE "routeId" IS NULL;

-- Step 5: stopDateをNOT NULLに変更
ALTER TABLE "DeliveryStop" ALTER COLUMN "stopDate" SET NOT NULL;

-- CreateIndex
CREATE INDEX "DeliveryStop_stopDate_idx" ON "DeliveryStop"("stopDate");

-- AddForeignKey
ALTER TABLE "DeliveryStop" ADD CONSTRAINT "DeliveryStop_planId_fkey" FOREIGN KEY ("planId") REFERENCES "DeliveryPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameColumn: loadMarginPercent（余裕率）から loadUtilizationPercent（積載利用率）へ、考え方を反転
ALTER TABLE "SystemSetting" RENAME COLUMN "loadMarginPercent" TO "loadUtilizationPercent";

-- 既存値を反転（余裕率X% → 利用率(100-X)%）してから新しいデフォルトに変更
UPDATE "SystemSetting" SET "loadUtilizationPercent" = 100 - "loadUtilizationPercent";
ALTER TABLE "SystemSetting" ALTER COLUMN "loadUtilizationPercent" SET DEFAULT 100;

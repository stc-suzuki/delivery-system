-- 配送先の位置を地図で手で指定したか
ALTER TABLE "Location" ADD COLUMN "positionManual" BOOLEAN NOT NULL DEFAULT false;

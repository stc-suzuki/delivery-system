/*
  すべてのPlanRouteに便（RouteTrip）を最低1件持たせるためのデータバックフィル。
  スキーマ変更は無し（RouteTrip/DeliveryStop.tripIdは既存カラム）。
  1. 便を1件も持たないPlanRouteに対し、tripIndex 0の便を1件作成する
     （PlanRoute自身のdepartureTime/status/returnedAt/startedByDispatcher/returnedByDispatcherをそのままコピー）
  2. そのルートの、便未指定（tripId IS NULL）の停車地を、今作った便0に割り当てる
     （既に便を持っていたルートの停車地には一切触れない）
*/
WITH backfilled AS (
  INSERT INTO "RouteTrip" ("id", "routeId", "tripIndex", "departureTime", "status", "returnedAt", "startedByDispatcher", "returnedByDispatcher", "createdAt")
  SELECT gen_random_uuid()::text, r.id, 0, r."departureTime", r.status, r."returnedAt", r."startedByDispatcher", r."returnedByDispatcher", now()
  FROM "PlanRoute" r
  WHERE NOT EXISTS (SELECT 1 FROM "RouteTrip" t WHERE t."routeId" = r.id)
  RETURNING id, "routeId"
)
UPDATE "DeliveryStop" ds
SET "tripId" = b.id
FROM backfilled b
WHERE ds."routeId" = b."routeId" AND ds."tripId" IS NULL;

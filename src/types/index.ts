export type ApiError = { error: string };

export type BulkLocationResult = {
  success: number;
  failed: number;
  errors: string[];
};

// CSV一括登録の結果（配送先・商品で共通の形）
export type BulkImportResult = BulkLocationResult;

export type OptimizeRequest = {
  locationIds: string[];
  truckIds: string[];
  driverIds: string[];
  force?: boolean;
};

export type RouteForMap = {
  id: string;
  color: string;
  stops: { lat: number; lng: number; order: number; name?: string }[];
};

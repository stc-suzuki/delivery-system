export type ApiError = { error: string };

export type BulkLocationResult = {
  success: number;
  failed: number;
  errors: string[];
};

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

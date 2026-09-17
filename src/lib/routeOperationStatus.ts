import { RouteStatus } from '@prisma/client';

export type RouteOperationStatus = 'BEFORE_START' | 'STARTED' | 'IN_OPERATION' | 'COMPLETED';

export const ROUTE_OPERATION_STATUS_LABELS: Record<RouteOperationStatus, string> = {
  BEFORE_START: '稼働前',
  STARTED: '運送開始',
  IN_OPERATION: '進行中',
  COMPLETED: '運送完了',
};

export const ROUTE_OPERATION_STATUS_STYLES: Record<RouteOperationStatus, string> = {
  BEFORE_START: 'bg-purple-100 text-purple-700',
  STARTED: 'bg-orange-100 text-orange-700',
  IN_OPERATION: 'bg-yellow-100 text-yellow-800',
  COMPLETED: 'bg-green-100 text-green-700',
};

export function computeRouteOperationStatus(status: RouteStatus, hasCompletedStop: boolean): RouteOperationStatus {
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'IN_PROGRESS') return hasCompletedStop ? 'IN_OPERATION' : 'STARTED';
  return 'BEFORE_START';
}

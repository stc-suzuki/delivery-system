import { PlanRoute } from '@prisma/client';
import { differenceInDays, startOfDay } from 'date-fns';
import { prisma } from './prisma';

// SystemSetting.truckScheduleHorizonDaysが未設定の場合のフォールバック（スキーマ上のデフォルト値と同じ）
const DEFAULT_EDIT_HORIZON_DAYS = 10;

// 「配車計画の先行登録可能日数」（トラック稼働登録・配送計画の編集の両方で共通）を取得する
export async function getEditHorizonDays(): Promise<number> {
  const settings = await prisma.systemSetting.findUnique({ where: { id: 'default' } });
  return settings?.truckScheduleHorizonDays ?? DEFAULT_EDIT_HORIZON_DAYS;
}

// 完了済み（COMPLETED）であっても、対象期間内であれば編集可能とする（2026-08-24決定）。
// 稼働中に配送先を追加する運用（本社に戻って積み直す）は、全停車地を配り終えて
// ルートがCOMPLETEDになった直後・帰社途中・帰社後のいずれでも同じ考え方が成り立つため、
// IN_PROGRESSと区別する理由がない
export function canEditRoute(route: Pick<PlanRoute, 'status' | 'routeDate'>, horizonDays: number): boolean {
  const today = startOfDay(new Date());
  const routeDate = startOfDay(new Date(route.routeDate));
  const diff = differenceInDays(routeDate, today);
  return diff >= 0 && diff <= horizonDays;
}

export type EditWarning = 'none' | 'same_day' | 'locked';

export function getEditWarning(route: Pick<PlanRoute, 'status' | 'routeDate'>, horizonDays: number): EditWarning {
  if (!canEditRoute(route, horizonDays)) return 'locked';
  const today = startOfDay(new Date());
  const routeDate = startOfDay(new Date(route.routeDate));
  return differenceInDays(routeDate, today) === 0 ? 'same_day' : 'none';
}

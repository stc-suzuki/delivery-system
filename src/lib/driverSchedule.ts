import { isHoliday } from 'japanese-holidays';
import { DriverType } from '@prisma/client';

export const DRIVER_TYPE_LABELS: Record<DriverType, string> = {
  FIXED_ROUTE: '固定ルート',
  REGULAR: '専任',
  SALES: '営業',
};

// 土日・祝日はデフォルトで休日。それ以外の平日はDriverDayOffで個別に休日を設定する。
export function isDefaultDayOff(date: Date): boolean {
  const day = date.getDay();
  if (day === 0 || day === 6) return true;
  return !!isHoliday(date);
}

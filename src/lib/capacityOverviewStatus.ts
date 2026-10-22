// /api/capacity-overview の1日分のレスポンスから、状況区分（OK/注意/超過など）を判定する純粋関数。
// 画面（capacity-overview/page.tsx）とサイドバーのバッジ（Sidebar.tsx）の両方で同じ閾値を使うために切り出した。
export type DayCapacity = {
  date: string;
  volumeM3: number;
  unassignedCount: number;
  truckCount: number;
  uncappedTruckCount: number;
  totalM3: number;
  effectiveM3: number;
  overCapacity: boolean;
  overTime: boolean;
  /** 時間指定に間に合わない見込みの配送先（荷物受付の見込み欄と同じ判定） */
  arrivalConflicts?: { locationName: string; requestedArrivalTime: string }[];
};

export type DayStatusKind = 'no-truck' | 'no-capacity' | 'over' | 'warning' | 'ok';

export const WARNING_USAGE_RATIO = 0.8;

// 容積のみの判定（時間超過は別軸のため、ここには混ぜない。サイドバーのバッジ件数は
// 容積警告・容積超過・時間超過をそれぞれ独立に数える。Sidebar.tsx参照）
export function dayStatusKind(day: DayCapacity): DayStatusKind {
  if (day.truckCount === 0) return 'no-truck';
  if (day.effectiveM3 === 0) return 'no-capacity';
  if (day.overCapacity) return 'over';
  const usageRatio = day.volumeM3 / day.effectiveM3;
  if (usageRatio >= WARNING_USAGE_RATIO) return 'warning';
  return 'ok';
}

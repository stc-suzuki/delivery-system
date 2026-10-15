'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardCheck } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import RelativeDayBadge from '@/components/plans/RelativeDayBadge';
import { dayStatusKind, type DayCapacity } from '@/lib/capacityOverviewStatus';

function statusOf(day: DayCapacity): { label: string; badgeClass: string; rowClass: string } {
  switch (dayStatusKind(day)) {
    case 'no-truck':
      return { label: 'トラック未登録', badgeClass: 'bg-gray-200 text-gray-600', rowClass: 'border-panel-line bg-panel' };
    case 'no-capacity':
      return { label: '容量未設定', badgeClass: 'bg-gray-200 text-gray-600', rowClass: 'border-panel-line bg-panel' };
    case 'over':
      return { label: '⚠ 超過', badgeClass: 'bg-red-600 text-white', rowClass: 'border-red-300 bg-red-50' };
    case 'warning':
      return { label: '注意', badgeClass: 'bg-amber-500 text-white', rowClass: 'border-amber-300 bg-amber-50' };
    default:
      return { label: 'OK', badgeClass: 'bg-gray-100 text-gray-600', rowClass: 'border-panel-line bg-panel' };
  }
}

export default function CapacityOverviewPage() {
  const [days, setDays] = useState<DayCapacity[] | null>(null);
  const [loadUtilizationPercent, setLoadUtilizationPercent] = useState(100);
  const [assumedTripsPerDay, setAssumedTripsPerDay] = useState(2);
  const [deliveryEndTime, setDeliveryEndTime] = useState('17:00');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/capacity-overview')
      .then(res => res.json())
      .then((data: { days?: DayCapacity[]; loadUtilizationPercent?: number; assumedTripsPerDay?: number; deliveryEndTime?: string; error?: string }) => {
        if (data.error) throw new Error(data.error);
        setDays(data.days ?? []);
        setLoadUtilizationPercent(data.loadUtilizationPercent ?? 100);
        setAssumedTripsPerDay(data.assumedTripsPerDay ?? 2);
        setDeliveryEndTime(data.deliveryEndTime ?? '17:00');
      })
      .catch(err => setError(err instanceof Error ? err.message : '取得に失敗しました'));
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ClipboardCheck}
        title="荷物受付状況の確認"
        description="「荷物受付」で登録されたデータのうち、容量オーバー・時間オーバー・未割当がないかをまとめてチェックできます。"
        tint="blueSoft"
      />
      <p className="text-xs text-gray-500">
        ※ 容積の判定にはシステム設定の積載利用率（{loadUtilizationPercent}%）・1日あたりの想定往復回数（{assumedTripsPerDay}往復）を反映した実効容量を、時間の判定には運送終了時間（定時
        {deliveryEndTime}）を使用しています。
      </p>

      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      {!days ? (
        <p className="text-gray-500">読み込み中...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-panel-line bg-panel shadow-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500">
              <tr>
                <th className="px-3 py-2">日付</th>
                <th className="px-3 py-2">状況</th>
                <th className="px-3 py-2">登録済み体積 / 実効容量</th>
                <th className="px-3 py-2">使用率</th>
                <th className="px-3 py-2">時間</th>
                <th className="px-3 py-2">未割当</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {days.map(day => {
                const status = statusOf(day);
                const usageRatio = day.effectiveM3 > 0 ? day.volumeM3 / day.effectiveM3 : null;
                const barTone = day.overCapacity ? 'bg-red-500' : (usageRatio ?? 0) >= 0.8 ? 'bg-amber-500' : 'bg-gray-400';
                return (
                  <tr key={day.date} className={`border-t ${status.rowClass}`}>
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-medium text-gray-800">
                          {day.date.slice(5, 7)}/{day.date.slice(8, 10)}
                        </span>
                        <RelativeDayBadge date={day.date} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${status.badgeClass}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {day.truckCount === 0 ? (
                        <span className="text-[#4B5563]">—</span>
                      ) : day.effectiveM3 === 0 ? (
                        <span className="text-[#4B5563]">登録済み{day.volumeM3.toFixed(2)}m3（容量未設定）</span>
                      ) : (
                        <>
                          {day.volumeM3.toFixed(2)}m3 / {day.effectiveM3.toFixed(2)}m3
                          {day.uncappedTruckCount > 0 && (
                            <span className="ml-1 text-xs text-[#4B5563]">（{day.uncappedTruckCount}台は容量未設定で除外）</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {usageRatio !== null ? (
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-200">
                            <div
                              className={`h-full rounded-full ${barTone}`}
                              style={{ width: `${Math.min(usageRatio, 1) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-[#4B5563]">{Math.round(usageRatio * 100)}%</span>
                        </div>
                      ) : (
                        <span className="text-[#4B5563]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {day.truckCount === 0 ? (
                        <span className="text-[#4B5563]">—</span>
                      ) : day.overTime ? (
                        <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">⚠ 時間超過</span>
                      ) : (
                        <span className="text-xs text-[#4B5563]">OK</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {day.unassignedCount > 0 ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          {day.unassignedCount}件
                        </span>
                      ) : (
                        <span className="text-[#4B5563]">0件</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {day.truckCount > 0 && (
                        <Link href={`/pool?date=${day.date}`} className="text-xs text-blue-600 hover:underline">
                          荷物受付を開く
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

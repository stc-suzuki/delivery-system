'use client';

import { Fragment } from 'react';
import { ReturnStatusPill } from './ReturnStatus';

type DriverRow = {
  id: string;
  name: string;
  type: 'FIXED_ROUTE' | 'REGULAR' | 'SALES';
  status: 'IN_PROGRESS' | 'IDLE' | 'COMPLETED';
  truck: string | null;
  // 配達完了グループの「帰社」列（帰社済みの時刻／帰社途中の帰社予定時刻）の表示用。配達完了以外では未使用
  returnedAt: string | null;
  returnEta: string | null;
  // 進行中グループ内で「N/M便」を示すバッジ表示用。便が2件以上あるルートのみ設定される
  currentTrip: { index: number; total: number } | null;
};

const STATUS_STYLES: Record<DriverRow['status'], string> = {
  IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
  IDLE: 'bg-gray-100 text-gray-600',
  COMPLETED: 'bg-green-100 text-green-700',
};

const STATUS_LABELS: Record<DriverRow['status'], string> = {
  IN_PROGRESS: '進行中',
  IDLE: '待機中',
  COMPLETED: '配達完了',
};

const TYPE_LABELS: Record<DriverRow['type'], string> = {
  FIXED_ROUTE: '固定ルート',
  REGULAR: '専任',
  SALES: '営業',
};

const STATUS_ORDER: DriverRow['status'][] = ['IDLE', 'IN_PROGRESS', 'COMPLETED'];

function formatTruckNumber(plateNo: string | null): string {
  if (!plateNo) return '-';
  const match = plateNo.match(/(\d{4})(?!.*\d)/);
  return match ? match[1] : plateNo;
}

function StatusGroupTable({ status, group }: { status: DriverRow['status']; group: DriverRow[] }) {
  // 配達完了の欄では、帰社途中か帰社済みかを各ドライバーの行の下に欄の幅いっぱいで出す
  // （列として足すと、3列並びの狭い欄では名前・トラックが切れてしまうため）
  const showReturn = status === 'COMPLETED';
  return (
    <div className="rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
          {STATUS_LABELS[status]}
        </span>
        <span className="text-xs text-[#4B5563]">{group.length}名</span>
      </div>
      {group.length === 0 ? (
        <p className="py-3 text-center text-sm text-[#4B5563]">対象のドライバーはいません</p>
      ) : (
        <div className="max-h-[18rem] overflow-y-auto">
          <table className="w-full table-fixed text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-[#4B5563]">
                <th className="w-1/2 py-1.5 pr-2 text-left font-normal">ドライバー</th>
                <th className="w-1/4 py-1.5 pr-2 text-left font-normal">区分</th>
                <th className="w-1/4 py-1.5 pr-2 text-left font-normal">トラック</th>
              </tr>
            </thead>
            <tbody>
              {group.map(driver => (
                <Fragment key={driver.id}>
                  <tr className={showReturn ? '' : 'border-b border-gray-100 last:border-0'}>
                    <td className="py-1.5 pr-2 font-medium text-gray-800">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{driver.name}</span>
                        {status === 'IDLE' && driver.truck && (
                          <span className="shrink-0 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                            稼働前
                          </span>
                        )}
                        {status === 'IN_PROGRESS' && driver.currentTrip && (
                          <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                            {driver.currentTrip.index}/{driver.currentTrip.total}便
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 pr-2 text-gray-600">{TYPE_LABELS[driver.type]}</td>
                    <td className="truncate py-1.5 pr-2 text-gray-600">{formatTruckNumber(driver.truck)}</td>
                  </tr>
                  {showReturn && (
                    <tr className="border-b border-gray-100 last:border-0">
                      <td colSpan={3} className="pb-2">
                        <ReturnStatusPill returnedAt={driver.returnedAt} returnEta={driver.returnEta} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function DriverStatusTable({ drivers }: { drivers: DriverRow[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700">ドライバー稼働状況</h3>
      {drivers.length === 0 ? (
        <p className="rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] py-3 text-center text-sm text-[#4B5563] shadow-sm">
          ドライバーが登録されていません
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {STATUS_ORDER.map(status => (
            <StatusGroupTable
              key={status}
              status={status}
              group={drivers
                .filter(d => d.status === status)
                .sort((a, b) => (a.truck ? 0 : 1) - (b.truck ? 0 : 1))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

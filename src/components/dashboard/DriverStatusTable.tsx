'use client';

type DriverRow = {
  id: string;
  name: string;
  type: 'REGULAR' | 'SPOT';
  status: 'IN_PROGRESS' | 'IDLE' | 'COMPLETED';
  truck: string | null;
};

const STATUS_STYLES: Record<DriverRow['status'], string> = {
  IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
  IDLE: 'bg-gray-100 text-gray-600',
  COMPLETED: 'bg-green-100 text-green-700',
};

const STATUS_LABELS: Record<DriverRow['status'], string> = {
  IN_PROGRESS: '稼働中',
  IDLE: '待機中',
  COMPLETED: '配達完了',
};

const TYPE_LABELS: Record<DriverRow['type'], string> = {
  REGULAR: '専任',
  SPOT: 'スポット',
};

const STATUS_ORDER: DriverRow['status'][] = ['IN_PROGRESS', 'IDLE', 'COMPLETED'];

export default function DriverStatusTable({ drivers }: { drivers: DriverRow[] }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold text-gray-700">ドライバー稼働状況</h3>
      {drivers.length === 0 && <p className="py-3 text-center text-sm text-gray-500">ドライバーが登録されていません</p>}
      <div className="max-h-96 space-y-4 overflow-y-auto">
        {STATUS_ORDER.map(status => {
          const group = drivers.filter(d => d.status === status);
          if (group.length === 0) return null;
          return (
            <div key={status}>
              <div className="mb-1 flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
                  {STATUS_LABELS[status]}
                </span>
                <span className="text-xs text-gray-500">{group.length}名</span>
              </div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs text-gray-500">
                    <th className="py-1.5 pr-2">ドライバー</th>
                    <th className="py-1.5 pr-2">区分</th>
                    <th className="py-1.5 pr-2">トラック</th>
                  </tr>
                </thead>
                <tbody>
                  {group.map(driver => (
                    <tr key={driver.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-1.5 pr-2 font-medium text-gray-800">{driver.name}</td>
                      <td className="py-1.5 pr-2 text-gray-600">{TYPE_LABELS[driver.type]}</td>
                      <td className="py-1.5 pr-2 text-gray-600">{driver.truck ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

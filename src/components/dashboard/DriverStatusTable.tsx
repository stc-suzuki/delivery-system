'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
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

// 欄の区分。APIのIDLEは「その日のルートがあり出発前（稼働前）」と「ルートなし（待機）」の両方を含むため、
// トラックの有無で分ける。待機の人は欄を作らず、人数だけの1行（押すと名前が開く）にして高さを抑える
type Group = 'BEFORE_START' | 'IN_PROGRESS' | 'COMPLETED';

const GROUP_STYLES: Record<Group, string> = {
  BEFORE_START: 'bg-purple-100 text-purple-700',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
  COMPLETED: 'bg-green-100 text-green-700',
};

const GROUP_LABELS: Record<Group, string> = {
  BEFORE_START: '稼働前',
  IN_PROGRESS: '進行中',
  COMPLETED: '配達完了',
};

// 画面名の横の件数（ルート・稼働前・進行中・完了）と同じ並び
const GROUP_ORDER: Group[] = ['BEFORE_START', 'IN_PROGRESS', 'COMPLETED'];

function groupOf(driver: DriverRow): Group | null {
  if (driver.status === 'IDLE') return driver.truck ? 'BEFORE_START' : null;
  return driver.status;
}

function formatTruckNumber(plateNo: string | null): string {
  if (!plateNo) return '-';
  const match = plateNo.match(/(\d{4})(?!.*\d)/);
  return match ? match[1] : plateNo;
}

// 欄の共通の枠。普段は区分のバッジと人数だけを出し、中身はボタンを押したときだけ開く（欄ごとに開閉）。
// 開閉の状態はこの欄の中だけで持つため、日付の切り替え・画面の開き直しで閉じた状態に戻る
// （30秒ごとの自動更新では欄が作り直されないため、開いたまま）
function CollapsibleCard({
  badge,
  badgeClassName,
  count,
  countSuffix = '',
  headerExtra,
  openLabel,
  closeLabel,
  children,
}: {
  badge: string;
  badgeClassName: string;
  count: number;
  countSuffix?: string;
  headerExtra?: ReactNode;
  openLabel: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-panel-line bg-panel px-4 py-3 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClassName}`}>
          {badge}
        </span>
        <span className="whitespace-nowrap text-xs text-[#4B5563]">
          <span className="font-bold text-gray-800">{count}名</span>
          {countSuffix}
        </span>
        {headerExtra}
      </div>
      {count === 0 ? (
        <p className="py-0.5 text-sm text-[#4B5563]">対象のドライバーはいません</p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className="flex items-center gap-0.5 py-0.5 text-xs text-blue-600 hover:underline"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {open ? closeLabel : openLabel}
          </button>
          {open && children}
        </>
      )}
    </div>
  );
}

function StatusGroupTable({ group, drivers }: { group: Group; drivers: DriverRow[] }) {
  // 配達完了の欄では、帰社途中か帰社済みかが一番知りたい情報のため「帰社」列を出す
  // （帰社の列は表示が切れない幅で固定し、狭い画面では名前を省略する）。
  // 畳んでいても分かるよう、帰社途中の人数は見出しに常に出す
  const showReturn = group === 'COMPLETED';
  const returningCount = showReturn ? drivers.filter(d => !d.returnedAt).length : 0;
  return (
    <CollapsibleCard
      badge={GROUP_LABELS[group]}
      badgeClassName={GROUP_STYLES[group]}
      count={drivers.length}
      headerExtra={
        showReturn &&
        drivers.length > 0 && (
          <span className="whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            帰社途中 {returningCount}名
          </span>
        )
      }
      openLabel="詳細を表示"
      closeLabel="詳細を閉じる"
    >
      <div className="max-h-[18rem] overflow-y-auto pt-0.5">
        <table className="w-full table-fixed text-left text-sm">
          <tbody>
            {drivers.map(driver => (
              <tr key={driver.id} className="border-b border-gray-100 last:border-0">
                <td className="py-0.5 pr-2 font-medium text-gray-800">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate">{driver.name}</span>
                    {group === 'IN_PROGRESS' && driver.currentTrip && (
                      <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                        {driver.currentTrip.index}/{driver.currentTrip.total}便
                      </span>
                    )}
                  </div>
                </td>
                <td className="w-[3.75rem] truncate py-0.5 pr-2 text-gray-600">{formatTruckNumber(driver.truck)}</td>
                {showReturn && (
                  <td className="w-[8.25rem] py-0.5">
                    <ReturnStatusPill returnedAt={driver.returnedAt} returnEta={driver.returnEta} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleCard>
  );
}

export default function DriverStatusTable({ drivers }: { drivers: DriverRow[] }) {
  const waiting = drivers.filter(d => groupOf(d) === null);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700">ドライバー稼働状況</h3>
      {drivers.length === 0 ? (
        <p className="rounded-lg border border-panel-line bg-panel py-3 text-center text-sm text-[#4B5563] shadow-sm">
          ドライバーが登録されていません
        </p>
      ) : (
        // 待機の欄は3つの欄と同じ並びの4つ目に置く。
        // 配達完了の欄は帰社の列がある分だけ広く、待機の欄は狭くする（1280px以上で4列）
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,0.8fr)]">
          {GROUP_ORDER.map(group => (
            <StatusGroupTable key={group} group={group} drivers={drivers.filter(d => groupOf(d) === group)} />
          ))}
          <CollapsibleCard
            badge="待機"
            badgeClassName="bg-gray-100 text-gray-600"
            count={waiting.length}
            countSuffix="（ルートなし）"
            openLabel="名前を表示"
            closeLabel="名前を閉じる"
          >
            <p className="max-h-[18rem] overflow-y-auto pt-0.5 text-xs leading-relaxed text-gray-700">
              {waiting.map(d => d.name).join('、')}
            </p>
          </CollapsibleCard>
        </div>
      )}
    </div>
  );
}

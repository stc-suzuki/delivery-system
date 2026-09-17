'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CalendarOff } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  isSameMonth,
} from 'date-fns';
import { ja } from 'date-fns/locale';
import { isDefaultDayOff, DRIVER_TYPE_LABELS } from '@/lib/driverSchedule';
import type { DriverType } from '@prisma/client';

type DriverInfo = { name: string; type: DriverType; status: string };

export default function DriverDayOffPage() {
  const params = useParams();
  const driverId = params.id as string;

  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [month, setMonth] = useState(() => new Date());
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function fetchDriver() {
    const res = await fetch('/api/drivers');
    const all: (DriverInfo & { id: string })[] = await res.json();
    setDriver(all.find(d => d.id === driverId) ?? null);
  }

  async function fetchDayOffs() {
    const res = await fetch(`/api/drivers/${driverId}/availability`);
    const data: { date: string }[] = await res.json();
    setDates(new Set(data.map(d => d.date.slice(0, 10))));
  }

  useEffect(() => {
    fetchDriver();
    fetchDayOffs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId]);

  const isInactive = driver?.status === 'INACTIVE';

  function toggle(day: Date) {
    if (isDefaultDayOff(day) || isInactive) return;
    const key = format(day, 'yyyy-MM-dd');
    setDates(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`/api/drivers/${driverId}/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates: Array.from(dates) }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setMessage('保存しました');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  return (
    <div className="space-y-4">
      <PageHeader
        icon={CalendarOff}
        title="休日設定"
        tint="gray"
        description={
          driver ? (
            <>
              <span className="font-semibold text-gray-700">{driver.name}</span>
              <span className="ml-2 text-gray-500">（{DRIVER_TYPE_LABELS[driver.type]}）</span>
            </>
          ) : (
            '土日・祝日はデフォルトで休日です。それ以外の平日をクリックすると休日として設定できます。'
          )
        }
      />
      {driver && (
        <p className="text-sm text-gray-500">
          土日・祝日はデフォルトで休日です。それ以外の平日をクリックすると休日として設定できます。
        </p>
      )}
      {isInactive && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          このドライバーは削除済みのため、休日設定を変更できません。
        </p>
      )}

      <div className="flex items-center justify-between">
        <button onClick={() => setMonth(m => subMonths(m, 1))} className="rounded bg-gray-100 px-3 py-1 text-sm hover:bg-gray-200">
          ← 前月
        </button>
        <h2 className="text-lg font-semibold">{format(month, 'yyyy年 M月', { locale: ja })}</h2>
        <button onClick={() => setMonth(m => addMonths(m, 1))} className="rounded bg-gray-100 px-3 py-1 text-sm hover:bg-gray-200">
          翌月 →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        {['日', '月', '火', '水', '木', '金', '土'].map(d => (
          <div key={d} className="text-center text-xs font-medium text-gray-500">{d}</div>
        ))}
        {days.map(day => {
          const key = format(day, 'yyyy-MM-dd');
          const defaultOff = isDefaultDayOff(day);
          const manualOff = dates.has(key);
          const off = defaultOff || manualOff;
          const inMonth = isSameMonth(day, month);
          return (
            <button
              key={key}
              onClick={() => toggle(day)}
              disabled={defaultOff || isInactive}
              className={`flex h-12 flex-col items-center justify-center rounded text-sm leading-tight ${
                off
                  ? defaultOff
                    ? 'cursor-default bg-red-100 text-red-600'
                    : 'bg-blue-600 text-white'
                  : `bg-gray-50 text-gray-700 ${isInactive ? 'cursor-not-allowed' : 'hover:bg-gray-100'}`
              } ${!inMonth ? 'opacity-30' : ''}`}
            >
              <span>{format(day, 'd')}</span>
              <span className="text-[10px]">{off ? '休日' : '稼働日'}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-red-100" />土日・祝日（休日）</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-blue-600" />設定した休日</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-gray-50 border border-gray-200" />稼働日</span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || isInactive}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存'}
        </button>
        {message && <span className="text-sm text-gray-600">{message}</span>}
      </div>
    </div>
  );
}

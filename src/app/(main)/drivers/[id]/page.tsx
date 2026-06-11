'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
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

export default function SpotDriverAvailabilityPage() {
  const params = useParams();
  const driverId = params.id as string;

  const [month, setMonth] = useState(() => new Date());
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function fetchAvailability() {
    const res = await fetch(`/api/drivers/${driverId}/availability`);
    const data: { date: string }[] = await res.json();
    setDates(new Set(data.map(d => d.date.slice(0, 10))));
  }

  useEffect(() => {
    fetchAvailability();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId]);

  function toggle(day: Date) {
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
      <h1 className="text-xl font-bold text-gray-800">スポットドライバー稼働日設定</h1>

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
          const active = dates.has(key);
          const inMonth = isSameMonth(day, month);
          return (
            <button
              key={key}
              onClick={() => toggle(day)}
              className={`aspect-square rounded text-sm ${
                active ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
              } ${!inMonth ? 'opacity-30' : ''}`}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存'}
        </button>
        {message && <span className="text-sm text-gray-600">{message}</span>}
      </div>
    </div>
  );
}

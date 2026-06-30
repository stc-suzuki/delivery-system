'use client';

import { useEffect, useState } from 'react';

type Settings = {
  defaultDepartureTime: string;
  lunchBreakStart: string;
  lunchBreakEnd: string;
  defaultStopDurationMinutes: number;
  defaultCargoRatio: number;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(setSettings)
      .catch(() => setError('設定の取得に失敗しました'));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const updated = await res.json();
      setSettings(updated);
      setMessage('設定を保存しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return <p className="text-gray-500">読み込み中...</p>;
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl font-bold text-gray-800">システム設定</h1>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-gray-700">運送の出発時間（デフォルト時間）</label>
          <input
            type="time"
            value={settings.defaultDepartureTime}
            onChange={e => setSettings({ ...settings, defaultDepartureTime: e.target.value })}
            className="mt-1 w-40 rounded border border-gray-300 px-2 py-1.5 text-sm"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">昼休み時間</label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="time"
              value={settings.lunchBreakStart}
              onChange={e => setSettings({ ...settings, lunchBreakStart: e.target.value })}
              className="w-40 rounded border border-gray-300 px-2 py-1.5 text-sm"
              required
            />
            <span className="text-sm text-gray-500">〜</span>
            <input
              type="time"
              value={settings.lunchBreakEnd}
              onChange={e => setSettings({ ...settings, lunchBreakEnd: e.target.value })}
              className="w-40 rounded border border-gray-300 px-2 py-1.5 text-sm"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">配送先での積み下ろし時間（デフォルト時間）</label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={settings.defaultStopDurationMinutes}
              onChange={e => setSettings({ ...settings, defaultStopDurationMinutes: Number(e.target.value) })}
              className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
              required
            />
            <span className="text-sm text-gray-500">分</span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">荷量割合（デフォルト割合）</label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={100}
              value={settings.defaultCargoRatio}
              onChange={e => setSettings({ ...settings, defaultCargoRatio: Number(e.target.value) })}
              className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
              required
            />
            <span className="text-sm text-gray-500">%</span>
          </div>
        </div>

        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        {message && <p className="rounded bg-green-50 p-2 text-sm text-green-700">{message}</p>}

        <button
          type="submit"
          disabled={saving}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </form>
    </div>
  );
}

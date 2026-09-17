'use client';

import { useEffect, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';

type Settings = {
  defaultDepartureTime: string;
  lunchBreakStart: string;
  lunchBreakEnd: string;
  deliveryEndTime: string;
  defaultStopDurationMinutes: number;
  truckScheduleHorizonDays: number;
  excludeWeekendsAndHolidays: boolean;
  loadUtilizationPercent: number;
  assumedTripsPerDay: number;
  reloadDurationMinutes: number;
  assignmentStrategy: 'SWEEP' | 'SWEEP_BALANCED';
  depotName: string;
  depotAddress: string;
  depotLat: number;
  depotLng: number;
};

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5 rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      {children}
    </div>
  );
}

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
    <div className="max-w-3xl space-y-6">
      <PageHeader
        icon={SettingsIcon}
        title="システム設定"
        description="出発時間・昼休憩・稼働カレンダーなど全体のデフォルト値を設定します。"
        tint="gray"
      />

      <form onSubmit={handleSubmit} className="space-y-4">
        <SettingsCard title="運行時間">
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
              <span className="text-sm text-[#4B5563]">〜</span>
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
            <label className="block text-sm font-medium text-gray-700">運送終了時間（定時）</label>
            <input
              type="time"
              value={settings.deliveryEndTime}
              onChange={e => setSettings({ ...settings, deliveryEndTime: e.target.value })}
              className="mt-1 w-40 rounded border border-gray-300 px-2 py-1.5 text-sm"
              required
            />
            <p className="mt-1 text-xs text-[#4B5563]">
              この時刻までに配達を終えられるかどうかを、荷物受付状況の確認画面での時間超過チェックの基準にします。
            </p>
          </div>
        </SettingsCard>

        <SettingsCard title="本部情報">
          <div>
            <label className="block text-sm font-medium text-gray-700">本部名称</label>
            <input
              type="text"
              value={settings.depotName}
              onChange={e => setSettings({ ...settings, depotName: e.target.value })}
              className="mt-1 w-72 rounded border border-gray-300 px-2 py-1.5 text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">本部住所</label>
            <input
              type="text"
              value={settings.depotAddress}
              onChange={e => setSettings({ ...settings, depotAddress: e.target.value })}
              placeholder="栃木県宇都宮市…"
              className="mt-1 w-96 rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            <p className="mt-1 text-xs text-[#4B5563]">
              全ルート共通の出発・帰着地点として使います。保存すると住所から座標を自動的に算出します（現在の座標：緯度{settings.depotLat.toFixed(4)}・経度{settings.depotLng.toFixed(4)}）。
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">本社での積み込み時間（稼働中ルートへの配送先追加時）</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={settings.reloadDurationMinutes}
                onChange={e => setSettings({ ...settings, reloadDurationMinutes: Number(e.target.value) })}
                className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
                required
              />
              <span className="text-sm text-[#4B5563]">分</span>
            </div>
            <p className="mt-1 text-xs text-[#4B5563]">
              稼働中のルートに新しい配送先を追加すると、ドライバーは一旦本社に戻ってから荷物を積み込んで再出発します。この積み込みにかかる所要時間を、到着予定時刻の再計算に使います（本社までの移動時間は別途自動計算されます）。
            </p>
          </div>
        </SettingsCard>

        <SettingsCard title="積載・容量">
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
              <span className="text-sm text-[#4B5563]">分</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">積載利用率（デッドスペース対策）</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={10}
                max={100}
                value={settings.loadUtilizationPercent}
                onChange={e => setSettings({ ...settings, loadUtilizationPercent: Number(e.target.value) })}
                className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
                required
              />
              <span className="text-sm text-[#4B5563]">%（10〜100）</span>
            </div>
            <p className="mt-1 text-xs text-[#4B5563]">
              実際にトラックへ荷物を積むと隙間（デッドスペース）が生じるため、荷物受付画面の容積超過チェックでは「トラック容量 × この値」を実効容量として判定します。100%なら容量いっぱいまで積める前提（キチキチ）で判定し、値を下げるほど余裕を持たせた判定になります。
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">1日あたりの想定往復回数</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={settings.assumedTripsPerDay}
                onChange={e => setSettings({ ...settings, assumedTripsPerDay: Number(e.target.value) })}
                className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
                required
              />
              <span className="text-sm text-[#4B5563]">往復（1以上）</span>
            </div>
            <p className="mt-1 text-xs text-[#4B5563]">
              トラック1台が1日に本社と何往復できるかの想定値です。荷物受付画面の容積超過チェックでは「トラック容量の合計 × この値」をその日の実効容量とします（1台＝1回の積み込みで1日分を配りきる前提ではなくなったため）。
            </p>
          </div>
        </SettingsCard>

        <SettingsCard title="計画・カレンダー">
          <div>
            <label className="block text-sm font-medium text-gray-700">配車計画の先行登録可能日数</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={30}
                value={settings.truckScheduleHorizonDays}
                onChange={e => setSettings({ ...settings, truckScheduleHorizonDays: Number(e.target.value) })}
                className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
                required
              />
              <span className="text-sm text-[#4B5563]">日先まで（1〜30）</span>
            </div>
            <p className="mt-1 text-xs text-[#4B5563]">
              「稼働トラックの登録」画面では、本日から何日先までトラック・ドライバーを登録できるかを設定します。「配送計画の作成」画面では、本日から何日先まで配送計画を作成できるかを設定します。
            </p>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={settings.excludeWeekendsAndHolidays}
                onChange={e => setSettings({ ...settings, excludeWeekendsAndHolidays: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300"
              />
              土日祝日は配送除外日とする
            </label>
            <p className="mt-1 text-xs text-[#4B5563]">
              チェックすると、土曜・日曜・日本の祝日には「稼働トラックの登録」画面でトラックを登録できなくなります。
            </p>
          </div>
        </SettingsCard>

        <SettingsCard title="AI提案">
          <div>
            <label className="block text-sm font-medium text-gray-700">AI提案（自動割当）の割当方式</label>
            <select
              value={settings.assignmentStrategy}
              onChange={e =>
                setSettings({ ...settings, assignmentStrategy: e.target.value as Settings['assignmentStrategy'] })
              }
              className="mt-1 w-72 rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="SWEEP_BALANCED">方面優先＋積載バランス調整（推奨）</option>
              <option value="SWEEP">方面優先のみ</option>
            </select>
            <p className="mt-1 text-xs text-[#4B5563]">
              荷物受付から未割当の配送先をトラックへ振り分ける参考提案（「AI提案」バッジ・「参考の割当案をすべて反映」）の方式です。本社から見た方位角順に処理し、同じ方面をなるべく1台のトラックにまとめます。「積載バランス調整」を有効にすると、トラックを切り替える必要が生じた際に最も積載率の低いトラックを優先するため、特定の1台に偏りにくくなりますが、方面のまとまりが多少崩れる場合があります。固定ルート等、方面を厳密に優先したい場合は「方面優先のみ」を選んでください。
            </p>
          </div>
        </SettingsCard>

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

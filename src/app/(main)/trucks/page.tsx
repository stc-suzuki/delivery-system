'use client';

import { useEffect, useState } from 'react';
import { Truck as TruckIcon } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useDialog } from '@/components/ui/DialogProvider';
import { resolveTruckBed } from '@/lib/loadCapacity';

type Truck = {
  id: string;
  plateNo: string;
  model: string;
  capacityKg: number;
  capacityM3: number | null;
  bedWidth: number | null;
  bedDepth: number | null;
  bedHeight: number | null;
  status: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
  defaultDriverId: string | null;
};

type Driver = { id: string; name: string; type: 'FIXED_ROUTE' | 'REGULAR' | 'SALES'; status: 'ACTIVE' | 'INACTIVE' };

const DRIVER_TYPE_LABELS: Record<Driver['type'], string> = {
  FIXED_ROUTE: '固定',
  REGULAR: '専任',
  SALES: '営業',
};

const STATUS_LABELS: Record<Truck['status'], string> = {
  AVAILABLE: '使用可能',
  IN_USE: '使用中',
  MAINTENANCE: '整備中',
  RETIRED: '廃車済み',
};

// RETIREDは削除操作からのみ設定される状態のため、新規登録・編集フォームの手動選択肢には出さない
const EDITABLE_STATUS_OPTIONS: Exclude<Truck['status'], 'RETIRED'>[] = ['AVAILABLE', 'IN_USE', 'MAINTENANCE'];

export default function TrucksPage() {
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [plateNo, setPlateNo] = useState('');
  const [model, setModel] = useState('');
  const [capacityKg, setCapacityKg] = useState('');
  const [bedWidth, setBedWidth] = useState('');
  const [bedDepth, setBedDepth] = useState('');
  const [bedHeight, setBedHeight] = useState('');
  const [status, setStatus] = useState<Truck['status']>('AVAILABLE');
  const [defaultDriverId, setDefaultDriverId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { confirmDialog, warnDialog } = useDialog();

  async function fetchTrucks() {
    const res = await fetch('/api/trucks');
    setTrucks(await res.json());
  }

  useEffect(() => {
    fetchTrucks();
    fetch('/api/drivers').then(res => res.json()).then(setDrivers);
  }, []);

  function driverName(id: string | null) {
    if (!id) return '-';
    return drivers.find(d => d.id === id)?.name ?? '-';
  }

  function startEdit(t: Truck) {
    setEditingId(t.id);
    setPlateNo(t.plateNo);
    setModel(t.model);
    setCapacityKg(String(t.capacityKg));
    setBedWidth(t.bedWidth !== null ? String(t.bedWidth) : '');
    setBedDepth(t.bedDepth !== null ? String(t.bedDepth) : '');
    setBedHeight(t.bedHeight !== null ? String(t.bedHeight) : '');
    setStatus(t.status);
    setDefaultDriverId(t.defaultDriverId ?? '');
  }

  function resetForm() {
    setEditingId(null);
    setPlateNo('');
    setModel('');
    setCapacityKg('');
    setBedWidth('');
    setBedDepth('');
    setBedHeight('');
    setStatus('AVAILABLE');
    setDefaultDriverId('');
  }

  // 容積上限は入力させず、荷台寸法から計算した値を表示する（保存時もサーバー側で同じ計算をする）
  const bedResult = resolveTruckBed({ bedWidth, bedDepth, bedHeight });
  const computedCapacityM3 = 'error' in bedResult ? null : bedResult.capacityM3;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const url = editingId ? `/api/trucks/${editingId}` : '/api/trucks';
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plateNo,
          model,
          capacityKg,
          bedWidth: bedWidth ? Number(bedWidth) : null,
          bedDepth: bedDepth ? Number(bedDepth) : null,
          bedHeight: bedHeight ? Number(bedHeight) : null,
          status,
          defaultDriverId: defaultDriverId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      resetForm();
      fetchTrucks();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(t: Truck) {
    if (!(await confirmDialog(`「${t.plateNo}」を削除しますか？この操作は取り消せません。`, { variant: 'danger' }))) return;
    setDeletingId(t.id);
    try {
      const res = await fetch(`/api/trucks/${t.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.mode === 'deactivated') {
        await warnDialog(
          `「${t.plateNo}」には過去の配送実績があるため完全には削除できません。今後の割当に使われないよう、廃車済み状態に変更しました。`,
          { title: '廃車済み状態に変更しました' }
        );
      }
      if (editingId === t.id) resetForm();
      fetchTrucks();
    } catch (err) {
      await warnDialog(err instanceof Error ? err.message : '削除に失敗しました', { title: '削除できませんでした' });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={TruckIcon}
        title="トラック管理"
        description="登録済みトラックの一覧・編集を行います。"
        tint="gray"
      />

      <div className="rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">{editingId ? 'トラック編集' : '新規登録'}</h2>
        {error && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            <input
              required
              placeholder="ナンバー"
              value={plateNo}
              onChange={e => setPlateNo(e.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="型式"
              value={model}
              onChange={e => setModel(e.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              required
              type="number"
              placeholder="積載量(kg)"
              value={capacityKg}
              onChange={e => setCapacityKg(e.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <div
              className="flex items-center rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-[#4B5563]"
              title="荷台の幅×奥行き×高さから自動で計算します"
            >
              容積上限: {computedCapacityM3 !== null ? `${computedCapacityM3}m3` : '自動計算'}
            </div>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as Truck['status'])}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            >
              {EDITABLE_STATUS_OPTIONS.map(value => (
                <option key={value} value={value}>{STATUS_LABELS[value]}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <select
              value={defaultDriverId}
              onChange={e => setDefaultDriverId(e.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">デフォルトドライバー（任意）</option>
              {/* 削除済み（INACTIVE）のドライバーは選択肢に出さない。ただし編集中のトラックに既に設定されている場合だけは、空欄に見えないよう残す */}
              {drivers
                .filter(d => d.status === 'ACTIVE' || d.id === defaultDriverId)
                .map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}（{DRIVER_TYPE_LABELS[d.type]}）{d.status === 'INACTIVE' ? '※削除済み' : ''}
                  </option>
                ))}
            </select>
            <input
              required
              type="number"
              step="0.01"
              min="0.01"
              placeholder="荷台幅(m)"
              value={bedWidth}
              onChange={e => setBedWidth(e.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              required
              type="number"
              step="0.01"
              min="0.01"
              placeholder="荷台奥行き(m)"
              value={bedDepth}
              onChange={e => setBedDepth(e.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              required
              type="number"
              step="0.01"
              min="0.01"
              placeholder="荷台高さ(m)"
              value={bedHeight}
              onChange={e => setBedHeight(e.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="flex gap-2 sm:col-span-2">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '保存中...' : editingId ? '更新' : '登録'}
              </button>
              {editingId && (
                <button type="button" onClick={resetForm} className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200">
                  キャンセル
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-[#4B5563]">
            荷台の幅・奥行き・高さは必須です。容積上限は荷台寸法（幅×奥行き×高さ）から自動で計算します。積み込み時の隙間によるゆとりは、システム設定の「積載利用率」で全トラック一括に設定します。
          </p>
        </form>
      </div>


      <div className="overflow-x-auto rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">ナンバー</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">型式</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">積載量</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">容積上限</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">荷台寸法(幅×奥行き×高さ)</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">デフォルトドライバー</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">ステータス</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {trucks.map(t => {
              const retired = t.status === 'RETIRED';
              return (
              <tr key={t.id} className={retired ? 'bg-gray-50' : ''}>
                <td className={`px-4 py-2 ${retired ? 'text-gray-500' : ''}`}>{t.plateNo}</td>
                <td className={`px-4 py-2 ${retired ? 'text-gray-500' : ''}`}>{t.model}</td>
                <td className={`px-4 py-2 ${retired ? 'text-gray-500' : ''}`}>{t.capacityKg.toLocaleString()} kg</td>
                <td className={`px-4 py-2 ${retired ? 'text-gray-500' : ''}`}>{t.capacityM3 !== null ? `${t.capacityM3}m3` : '-'}</td>
                <td className={`px-4 py-2 ${retired ? 'text-gray-500' : ''}`}>
                  {t.bedWidth !== null && t.bedDepth !== null && t.bedHeight !== null
                    ? `${t.bedWidth}×${t.bedDepth}×${t.bedHeight}m`
                    : '-'}
                </td>
                <td className={`px-4 py-2 ${retired ? 'text-gray-500' : ''}`}>{driverName(t.defaultDriverId)}</td>
                <td className={`px-4 py-2 ${retired ? 'text-gray-500' : ''}`}>{STATUS_LABELS[t.status]}</td>
                <td className="flex gap-3 px-4 py-2">
                  {!retired ? (
                    <>
                      <button onClick={() => startEdit(t)} className="text-xs text-blue-600 hover:underline">
                        編集
                      </button>
                      <button
                        onClick={() => handleDelete(t)}
                        disabled={deletingId === t.id}
                        className="text-xs text-red-500 hover:underline disabled:opacity-50"
                      >
                        {deletingId === t.id ? '削除中...' : '削除'}
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-gray-600">削除済み</span>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

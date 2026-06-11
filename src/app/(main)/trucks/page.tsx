'use client';

import { useEffect, useState } from 'react';

type Truck = {
  id: string;
  plateNo: string;
  model: string;
  capacityKg: number;
  status: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE';
};

const STATUS_LABELS: Record<Truck['status'], string> = {
  AVAILABLE: '使用可能',
  IN_USE: '使用中',
  MAINTENANCE: '整備中',
};

export default function TrucksPage() {
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [plateNo, setPlateNo] = useState('');
  const [model, setModel] = useState('');
  const [capacityKg, setCapacityKg] = useState('');
  const [status, setStatus] = useState<Truck['status']>('AVAILABLE');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function fetchTrucks() {
    const res = await fetch('/api/trucks');
    setTrucks(await res.json());
  }

  useEffect(() => {
    fetchTrucks();
  }, []);

  function startEdit(t: Truck) {
    setEditingId(t.id);
    setPlateNo(t.plateNo);
    setModel(t.model);
    setCapacityKg(String(t.capacityKg));
    setStatus(t.status);
  }

  function resetForm() {
    setEditingId(null);
    setPlateNo('');
    setModel('');
    setCapacityKg('');
    setStatus('AVAILABLE');
  }

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
        body: JSON.stringify({ plateNo, model, capacityKg, status }),
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

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-800">トラック管理</h1>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">{editingId ? 'トラック編集' : '新規登録'}</h2>
        {error && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
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
          <select
            value={status}
            onChange={e => setStatus(e.target.value as Truck['status'])}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <div className="flex gap-2">
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
        </form>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">ナンバー</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">型式</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">積載量</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">ステータス</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {trucks.map(t => (
              <tr key={t.id}>
                <td className="px-4 py-2">{t.plateNo}</td>
                <td className="px-4 py-2">{t.model}</td>
                <td className="px-4 py-2">{t.capacityKg.toLocaleString()} kg</td>
                <td className="px-4 py-2">{STATUS_LABELS[t.status]}</td>
                <td className="px-4 py-2">
                  <button onClick={() => startEdit(t)} className="text-blue-600 hover:underline">
                    編集
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

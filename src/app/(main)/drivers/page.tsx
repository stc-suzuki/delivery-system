'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Driver = {
  id: string;
  name: string;
  phone: string;
  type: 'REGULAR' | 'SPOT';
  licenseNo: string;
  status: string;
};

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [tab, setTab] = useState<'REGULAR' | 'SPOT'>('REGULAR');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [licenseNo, setLicenseNo] = useState('');
  const [type, setType] = useState<'REGULAR' | 'SPOT'>('REGULAR');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function fetchDrivers() {
    const res = await fetch('/api/drivers');
    setDrivers(await res.json());
  }

  useEffect(() => {
    fetchDrivers();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, licenseNo, type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setName('');
      setPhone('');
      setLicenseNo('');
      fetchDrivers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  const filtered = drivers.filter(d => d.type === tab);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-800">ドライバー管理</h1>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">新規登録</h2>
        {error && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          <input
            required
            placeholder="名称"
            value={name}
            onChange={e => setName(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm sm:col-span-1"
          />
          <input
            required
            placeholder="電話番号"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm sm:col-span-1"
          />
          <input
            required
            placeholder="免許番号"
            value={licenseNo}
            onChange={e => setLicenseNo(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm sm:col-span-1"
          />
          <select
            value={type}
            onChange={e => setType(e.target.value as 'REGULAR' | 'SPOT')}
            className="rounded border border-gray-300 px-3 py-2 text-sm sm:col-span-1"
          >
            <option value="REGULAR">専任</option>
            <option value="SPOT">スポット</option>
          </select>
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 sm:col-span-1"
          >
            {saving ? '登録中...' : '登録'}
          </button>
        </form>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setTab('REGULAR')}
          className={`rounded px-4 py-2 text-sm font-medium ${tab === 'REGULAR' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
        >
          専任
        </button>
        <button
          onClick={() => setTab('SPOT')}
          className={`rounded px-4 py-2 text-sm font-medium ${tab === 'SPOT' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
        >
          スポット
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">名称</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">電話番号</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">免許番号</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">ステータス</th>
              {tab === 'SPOT' && <th className="px-4 py-2 text-left font-medium text-gray-500">稼働日</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(d => (
              <tr key={d.id}>
                <td className="px-4 py-2">{d.name}</td>
                <td className="px-4 py-2">{d.phone}</td>
                <td className="px-4 py-2">{d.licenseNo}</td>
                <td className="px-4 py-2">{d.status === 'ACTIVE' ? '稼働中' : '停止中'}</td>
                {tab === 'SPOT' && (
                  <td className="px-4 py-2">
                    <Link href={`/drivers/${d.id}`} className="text-blue-600 hover:underline">
                      稼働日設定
                    </Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

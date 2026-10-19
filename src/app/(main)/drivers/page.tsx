'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { DriverType } from '@prisma/client';
import { DRIVER_TYPE_LABELS } from '@/lib/driverSchedule';
import PageHeader from '@/components/ui/PageHeader';
import { useDialog } from '@/components/ui/DialogProvider';

type Driver = {
  id: string;
  name: string;
  phone: string;
  type: DriverType;
  status: string;
};

type DuplicateDriver = { name: string; phone: string; type: DriverType; status: string };

const TYPE_TABS: DriverType[] = ['FIXED_ROUTE', 'REGULAR', 'SALES'];

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [tab, setTab] = useState<DriverType>('FIXED_ROUTE');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState<DriverType>('FIXED_ROUTE');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { confirmDialog, warnDialog } = useDialog();

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
      const post = (allowDuplicateName: boolean) =>
        fetch('/api/drivers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone, type, allowDuplicateName }),
        });
      let res = await post(false);
      let data = await res.json();
      // 同じ名前のドライバーがいる場合は、二重登録でないかを確かめてから登録する
      if (res.status === 409 && data.duplicateName) {
        const list = (data.existing as DuplicateDriver[])
          .map(d => `・${d.name}（${DRIVER_TYPE_LABELS[d.type]}、${d.phone}${d.status === 'ACTIVE' ? '' : '、削除済み'}）`)
          .join('\n');
        const ok = await confirmDialog(
          `同じ名前のドライバーがすでに登録されています。\n${list}\n\n別の人として「${name}」を登録しますか？`,
          { confirmLabel: '登録する' }
        );
        if (!ok) return;
        res = await post(true);
        data = await res.json();
      }
      if (!res.ok) throw new Error(data.error);
      setName('');
      setPhone('');
      fetchDrivers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(d: Driver) {
    if (!(await confirmDialog(`「${d.name}」を削除しますか？この操作は取り消せません。`, { variant: 'danger' }))) return;
    setDeletingId(d.id);
    try {
      const res = await fetch(`/api/drivers/${d.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.mode === 'deactivated') {
        await warnDialog(
          `「${d.name}」には過去の配送実績があるため完全には削除できません。今後の割当に使われないよう、非稼働状態に変更しました。`,
          { title: '非稼働状態に変更しました' }
        );
      }
      fetchDrivers();
    } catch (err) {
      await warnDialog(err instanceof Error ? err.message : '削除に失敗しました', { title: '削除できませんでした' });
    } finally {
      setDeletingId(null);
    }
  }

  const filtered = drivers.filter(d => d.type === tab);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="ドライバー管理"
        description="ドライバーの登録・種別・休日設定を管理します。"
        tint="gray"
      />

      <div className="rounded-lg border border-panel-line bg-panel p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">新規登録</h2>
        {error && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
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
          <select
            value={type}
            onChange={e => setType(e.target.value as DriverType)}
            className="rounded border border-gray-300 px-3 py-2 text-sm sm:col-span-1"
          >
            {TYPE_TABS.map(t => (
              <option key={t} value={t}>{DRIVER_TYPE_LABELS[t]}</option>
            ))}
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
        {TYPE_TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-4 py-2 text-sm font-medium ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            {DRIVER_TYPE_LABELS[t]}
          </button>
        ))}
      </div>


      <div className="overflow-x-auto rounded-lg border border-panel-line bg-panel shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">名称</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">電話番号</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">ステータス</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(d => {
              const inactive = d.status !== 'ACTIVE';
              return (
              <tr key={d.id} className={inactive ? 'bg-gray-50' : ''}>
                <td className={`px-4 py-2 ${inactive ? 'text-gray-500' : ''}`}>{d.name}</td>
                <td className={`px-4 py-2 ${inactive ? 'text-gray-500' : ''}`}>{d.phone}</td>
                <td className={`px-4 py-2 ${inactive ? 'text-gray-500' : ''}`}>{d.status === 'ACTIVE' ? '稼働中' : '停止中'}</td>
                <td className="flex gap-3 px-4 py-2">
                  {d.status === 'ACTIVE' ? (
                    <>
                      <Link href={`/drivers/${d.id}`} className="text-xs text-blue-600 hover:underline">
                        休日設定
                      </Link>
                      <button
                        onClick={() => handleDelete(d)}
                        disabled={deletingId === d.id}
                        className="text-xs text-red-500 hover:underline disabled:opacity-50"
                      >
                        {deletingId === d.id ? '削除中...' : '削除'}
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

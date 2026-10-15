'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Building2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import type { RouteForMap } from '@/components/map/DeliveryMap';
import { useDialog } from '@/components/ui/DialogProvider';

const DeliveryMap = dynamic(() => import('@/components/map/DeliveryMap'), { ssr: false });

type Location = {
  id: string;
  name: string;
  address: string;
  formattedAddress: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  createdAt: string;
};

type BulkResult = { success: number; failed: number; errors: string[] };

// formattedAddressは国土地理院の住所検索で一致した場所の名前で、番地まで一致しないと
// 町名や市までしか返らない（その場合、地図上の位置もその町・市の代表地点になる）。
// 一致した名前に番地の数字や丁目が無く、入力した住所と違う場合は「おおよその位置」とみなす
function isApproximateMatch(loc: Location): boolean {
  if (!loc.formattedAddress || loc.formattedAddress === loc.address) return false;
  return !/[0-9０-９]|丁目|番/.test(loc.formattedAddress);
}

export default function LocationsPage() {
  const { confirmDialog, warnDialog } = useDialog();
  const [locations, setLocations] = useState<Location[]>([]);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [preview, setPreview] = useState<{ lat: number; lng: number; formattedAddress: string } | null>(null);
  // 編集中の配送先の、いま登録されている位置。「住所確認」をすると確認結果（preview）の表示に切り替わる
  const [savedPosition, setSavedPosition] = useState<{ lat: number; lng: number; formattedAddress: string | null } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function fetchLocations(q?: string) {
    const url = q ? `/api/locations?q=${encodeURIComponent(q)}` : '/api/locations';
    const res = await fetch(url);
    setLocations(await res.json());
  }

  useEffect(() => {
    fetchLocations();
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    fetchLocations(search);
  }

  async function handleCheckAddress() {
    setChecking(true);
    setError('');
    setPreview(null);
    try {
      // ジオコーディングのみ確認するため一時的にPOSTせず、サーバーAPIを流用
      const res = await fetch('/api/locations/geocode-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '住所確認に失敗しました');
    } finally {
      setChecking(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const url = editingId ? `/api/locations/${editingId}` : '/api/locations';
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, address, phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      resetForm();
      fetchLocations(search);
    } catch (err) {
      setError(err instanceof Error ? err.message : editingId ? '更新に失敗しました' : '登録に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(loc: Location) {
    setEditingId(loc.id);
    setName(loc.name);
    setAddress(loc.address);
    setPhone(loc.phone ?? '');
    setPreview(null);
    setSavedPosition({ lat: loc.lat, lng: loc.lng, formattedAddress: loc.formattedAddress });
    setError('');
    // 一覧の下の方で「編集」を押すと、フォームと地図が画面の外にあって気づけないため、フォームまで戻す
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetForm() {
    setEditingId(null);
    setName('');
    setAddress('');
    setPhone('');
    setPreview(null);
    setSavedPosition(null);
  }

  async function handleBulkUpload() {
    if (!csvFile) return;
    setUploading(true);
    setBulkResult(null);
    try {
      const formData = new FormData();
      formData.append('file', csvFile);
      let res: Response;
      try {
        res = await fetch('/api/locations/bulk', { method: 'POST', body: formData });
      } catch {
        // ファイルを選んだ後にそのファイルを保存し直すと、ブラウザが送信を拒否し「Failed to fetch」になる
        throw new Error(
          'ファイルを送信できませんでした。ファイルを選んだ後に保存し直した場合は、もう一度ファイルを選んでからアップロードしてください'
        );
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBulkResult(data);
      fetchLocations();
    } catch (err) {
      setBulkResult({ success: 0, failed: 0, errors: [err instanceof Error ? err.message : '一括登録に失敗しました'] });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(loc: Location) {
    if (!(await confirmDialog(`「${loc.name}」を削除しますか？この操作は取り消せません。`, { variant: 'danger' }))) return;
    setDeletingId(loc.id);
    try {
      const res = await fetch(`/api/locations/${loc.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (editingId === loc.id) resetForm();
      fetchLocations(search);
    } catch (err) {
      await warnDialog(err instanceof Error ? err.message : '削除に失敗しました', { title: '削除できませんでした' });
    } finally {
      setDeletingId(null);
    }
  }

  const mapPosition = preview ?? savedPosition;
  const previewRoutes: RouteForMap[] = mapPosition
    ? [{ id: 'preview', color: '#2563eb', stops: [{ lat: mapPosition.lat, lng: mapPosition.lng, order: 0, name }] }]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Building2}
        title="配送先管理"
        description="配送先の登録・住所・位置情報を管理します。"
        tint="gray"
      />

      <div ref={formRef} className="grid scroll-mt-4 grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 新規登録フォーム */}
        <div className="rounded-lg border border-panel-line bg-panel p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">{editingId ? '配送先編集' : '新規登録'}</h2>
          {error && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm text-gray-700">名称</label>
              <input
                required
                value={name}
                onChange={e => setName(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-700">住所</label>
              <div className="mt-1 flex gap-2">
                <input
                  required
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={handleCheckAddress}
                  disabled={!address || checking}
                  className="shrink-0 rounded bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                >
                  {checking ? '確認中...' : '住所確認'}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-700">電話番号</label>
              <input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            {preview ? (
              <p className="text-xs text-[#4B5563]">確認結果: {preview.formattedAddress}</p>
            ) : (
              savedPosition && (
                <p className="text-xs text-[#4B5563]">
                  地図は登録済みの位置です{savedPosition.formattedAddress ? `（${savedPosition.formattedAddress}）` : ''}。住所を変えた場合は「住所確認」で新しい位置を確かめてください。
                </p>
              )
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '保存中...' : editingId ? '更新' : '登録'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200"
                >
                  キャンセル
                </button>
              )}
            </div>
          </form>
        </div>

        {/* 地図プレビュー */}
        <div className="h-80 rounded-lg border border-panel-line bg-panel p-2 shadow-sm lg:h-auto">
          <DeliveryMap routes={previewRoutes} />
        </div>
      </div>

      {/* CSV一括登録 */}
      <div className="rounded-lg border border-panel-line bg-panel p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-gray-700">CSV一括登録（見出し：name,address,phone または 名称,住所,電話番号）</h2>
        <p className="mb-3 text-xs text-gray-500">Excelで保存したCSV（Shift_JIS）・UTF-8のどちらでも読み込めます。</p>
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".csv"
            onChange={e => setCsvFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <button
            onClick={handleBulkUpload}
            disabled={!csvFile || uploading}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? 'アップロード中...' : 'アップロード'}
          </button>
        </div>
        {bulkResult && (
          <div className="mt-3 text-sm">
            <p>成功: {bulkResult.success}件 / 失敗: {bulkResult.failed}件</p>
            {bulkResult.errors.length > 0 && (
              <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-5 text-xs text-red-600">
                {bulkResult.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 検索 */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="名称・住所で検索"
          className="w-full max-w-sm rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
          検索
        </button>
      </form>

      {/* 一覧テーブル */}
      <div className="overflow-x-auto rounded-lg border border-panel-line bg-panel shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">名称</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">住所</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">電話番号</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">登録日</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {locations.map(loc => (
              <tr key={loc.id}>
                <td className="px-4 py-2">{loc.name}</td>
                <td className="px-4 py-2">
                  {loc.address}
                  {isApproximateMatch(loc) && (
                    <p className="text-xs text-amber-700">地図上の位置は「{loc.formattedAddress}」付近（番地まで特定できませんでした）</p>
                  )}
                </td>
                <td className="px-4 py-2">{loc.phone ?? '-'}</td>
                <td className="px-4 py-2">{new Date(loc.createdAt).toLocaleDateString('ja-JP')}</td>
                <td className="flex gap-3 px-4 py-2">
                  <button onClick={() => startEdit(loc)} className="text-xs text-blue-600 hover:underline">
                    編集
                  </button>
                  <button
                    onClick={() => handleDelete(loc)}
                    disabled={deletingId === loc.id}
                    className="text-xs text-red-500 hover:underline disabled:opacity-50"
                  >
                    {deletingId === loc.id ? '削除中...' : '削除'}
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

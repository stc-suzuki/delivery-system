'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { RouteForMap } from '@/components/map/DeliveryMap';

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

export default function LocationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [preview, setPreview] = useState<{ lat: number; lng: number; formattedAddress: string } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);

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
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, address, phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setName('');
      setAddress('');
      setPhone('');
      setPreview(null);
      fetchLocations();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkUpload() {
    if (!csvFile) return;
    setUploading(true);
    setBulkResult(null);
    try {
      const formData = new FormData();
      formData.append('file', csvFile);
      const res = await fetch('/api/locations/bulk', { method: 'POST', body: formData });
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

  const previewRoutes: RouteForMap[] = preview
    ? [{ id: 'preview', color: '#2563eb', stops: [{ lat: preview.lat, lng: preview.lng, order: 0, name }] }]
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-800">配送先管理</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 新規登録フォーム */}
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">新規登録</h2>
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
            {preview && (
              <p className="text-xs text-gray-500">確認結果: {preview.formattedAddress}</p>
            )}
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '登録中...' : '登録'}
            </button>
          </form>
        </div>

        {/* 地図プレビュー */}
        <div className="h-80 rounded-lg border border-gray-200 bg-white p-2 shadow-sm lg:h-auto">
          <DeliveryMap routes={previewRoutes} />
        </div>
      </div>

      {/* CSV一括登録 */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">CSV一括登録（name,address,phone）</h2>
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
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">名称</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">住所</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">電話番号</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">登録日</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {locations.map(loc => (
              <tr key={loc.id}>
                <td className="px-4 py-2">{loc.name}</td>
                <td className="px-4 py-2">{loc.formattedAddress ?? loc.address}</td>
                <td className="px-4 py-2">{loc.phone ?? '-'}</td>
                <td className="px-4 py-2">{new Date(loc.createdAt).toLocaleDateString('ja-JP')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

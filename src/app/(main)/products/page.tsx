'use client';

import { useEffect, useState } from 'react';
import { Boxes } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useDialog } from '@/components/ui/DialogProvider';
import { BulkImportResult } from '@/types';

type Product = {
  id: string;
  name: string;
  width: number;
  depth: number;
  height: number;
};

export default function ProductsPage() {
  const { confirmDialog, warnDialog } = useDialog();
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState('');
  const [width, setWidth] = useState('');
  const [depth, setDepth] = useState('');
  const [height, setHeight] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkImportResult | null>(null);

  async function fetchProducts() {
    const res = await fetch('/api/products');
    setProducts(await res.json());
  }

  useEffect(() => {
    fetchProducts();
  }, []);

  function startEdit(p: Product) {
    setEditingId(p.id);
    setName(p.name);
    setWidth(String(p.width));
    setDepth(String(p.depth));
    setHeight(String(p.height));
  }

  function resetForm() {
    setEditingId(null);
    setName('');
    setWidth('');
    setDepth('');
    setHeight('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const url = editingId ? `/api/products/${editingId}` : '/api/products';
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, width, depth, height }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      resetForm();
      fetchProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
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
      let res: Response;
      try {
        res = await fetch('/api/products/bulk', { method: 'POST', body: formData });
      } catch {
        // ファイルを選んだ後にそのファイルを保存し直すと、ブラウザが送信を拒否し「Failed to fetch」になる
        throw new Error(
          'ファイルを送信できませんでした。ファイルを選んだ後に保存し直した場合は、もう一度ファイルを選んでからアップロードしてください'
        );
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBulkResult(data);
      fetchProducts();
    } catch (err) {
      setBulkResult({ success: 0, failed: 0, errors: [err instanceof Error ? err.message : '一括登録に失敗しました'] });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(p: Product) {
    if (!(await confirmDialog(`「${p.name}」を削除しますか？この操作は取り消せません。`, { variant: 'danger' }))) return;
    setDeletingId(p.id);
    try {
      const res = await fetch(`/api/products/${p.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (editingId === p.id) resetForm();
      fetchProducts();
    } catch (err) {
      await warnDialog(err instanceof Error ? err.message : '削除に失敗しました', { title: '削除できませんでした' });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Boxes}
        title="商品管理"
        description="荷物の寸法を商品として登録しておくと、配送先への荷物追加時に選ぶだけで入力できます。"
        tint="gray"
      />

      <div className="rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">{editingId ? '商品編集' : '新規登録'}</h2>
        {error && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          <input
            required
            placeholder="商品名"
            value={name}
            onChange={e => setName(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="number"
            step="0.01"
            placeholder="幅(m)"
            value={width}
            onChange={e => setWidth(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="number"
            step="0.01"
            placeholder="奥行き(m)"
            value={depth}
            onChange={e => setDepth(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="number"
            step="0.01"
            placeholder="高さ(m)"
            value={height}
            onChange={e => setHeight(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
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

      {/* CSV一括登録 */}
      <div className="rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-gray-700">CSV一括登録（見出し：商品名,幅,奥行き,高さ）</h2>
        <p className="mb-3 text-xs text-gray-500">
          寸法はm単位。見出しが無い場合は「商品名,幅,奥行き,高さ」の順として読みます（体積などその後ろの列は読みません）。Excelで保存したCSV（Shift_JIS）・UTF-8のどちらでも読み込めます。同じ名前の商品が既にある行は登録しません。
        </p>
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

      <div className="overflow-x-auto rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">商品名</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">寸法(幅×奥行き×高さ)</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">体積</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {products.map(p => (
              <tr key={p.id}>
                <td className="px-4 py-2">{p.name}</td>
                <td className="px-4 py-2">{p.width}×{p.depth}×{p.height}m</td>
                <td className="px-4 py-2">{(p.width * p.depth * p.height).toFixed(2)}m3</td>
                <td className="flex gap-3 px-4 py-2">
                  <button onClick={() => startEdit(p)} className="text-blue-600 hover:underline">
                    編集
                  </button>
                  <button
                    onClick={() => handleDelete(p)}
                    disabled={deletingId === p.id}
                    className="text-red-500 hover:underline disabled:opacity-50"
                  >
                    {deletingId === p.id ? '削除中...' : '削除'}
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

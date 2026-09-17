'use client';

import { useEffect, useState } from 'react';
import { Boxes } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';

type Product = {
  id: string;
  name: string;
  width: number;
  depth: number;
  height: number;
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState('');
  const [width, setWidth] = useState('');
  const [depth, setDepth] = useState('');
  const [height, setHeight] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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
                <td className="px-4 py-2">
                  <button onClick={() => startEdit(p)} className="text-blue-600 hover:underline">
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

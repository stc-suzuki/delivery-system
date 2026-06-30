'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';

export default function NewPlanPage() {
  const router = useRouter();
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planDate: date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/plans/${data.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : '作成に失敗しました');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-800">新規配送計画作成</h1>

      <div className="flex items-center gap-3">
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          onClick={handleCreate}
          disabled={creating}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {creating ? '作成中...' : '計画を作成'}
        </button>
      </div>
    </div>
  );
}

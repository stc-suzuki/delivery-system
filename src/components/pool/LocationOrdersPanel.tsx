'use client';

// 荷物受付「登録内容の確認・修正」の「配送先で探す」（2026-11-17導入）。日付を覚えていない変更・取り消しの
// 電話のとき、配送先名・電話番号から今日以降の受付を探す。左に今日以降に受付がある配送先だけを件数付きで並べ、
// 選ぶと右にその配送先の受付が日付をまたいで並ぶ。「編集」は日付で見るときと同じ編集欄（EditOrder）
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, AlertTriangle, Lock, Pencil, X } from 'lucide-react';
import { ArrivalTag, EditOrder, Product, RegisteredStop } from '@/components/pool/RegisteredOrdersPanel';
import { dayLabel, todayKey } from '@/components/pool/NewOrderPanel';

type UpcomingStop = RegisteredStop & {
  stopDate: string;
  location: { id: string; name: string; phone: string | null; address: string };
};

export default function LocationOrdersPanel({
  products,
  canManageTrucks,
  onChanged,
}: {
  products: Product[];
  canManageTrucks: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [stops, setStops] = useState<UpcomingStop[] | null>(null);
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'ng'; text: string } | null>(null);
  const today = todayKey();

  const load = useCallback(async () => {
    const res = await fetch('/api/pool/upcoming');
    const data = await res.json();
    setStops(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 今日以降に受付がある配送先（名前順）
  const locations = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; phone: string | null; address: string; count: number }>();
    for (const s of stops ?? []) {
      const e = byId.get(s.location.id);
      if (e) e.count++;
      else byId.set(s.location.id, { ...s.location, count: 1 });
    }
    const q = search.trim();
    return Array.from(byId.values())
      .filter(l => !q || l.name.includes(q) || (l.phone ?? '').includes(q) || l.address.includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }, [stops, search]);

  const selected = locations.find(l => l.id === locationId) ?? null;
  const orders = (stops ?? []).filter(s => s.location.id === locationId);

  // 左の幅は「日付で見る」のカレンダー（340px）・間隔（16px）と同じにする（2026-11-17ユーザー指定）
  return (
    <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
      <div className="rounded-lg border border-panel-line bg-white p-2">
        <div className="relative mb-1">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="配送先名・電話番号・住所の一部"
            className="w-full rounded border border-gray-300 py-1 pl-2 pr-7 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="検索の文字を消す"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="mb-1 text-xs text-gray-500">今日以降に受付がある配送先 {locations.length}件</p>
        <div className="max-h-[60vh] overflow-y-auto rounded border border-gray-300">
          <div className="sticky top-0 grid grid-cols-[minmax(0,1fr)_2.5rem] gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-500">
            <span>配送先</span>
            <span>件数</span>
          </div>
          {stops === null && <p className="px-2 py-2 text-xs text-gray-500">読み込み中...</p>}
          {stops !== null && locations.length === 0 && <p className="px-2 py-2 text-xs text-gray-500">今日以降の受付はありません</p>}
          {locations.map(l => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                setLocationId(l.id);
                setEditingId(null);
                setMessage(null);
              }}
              className={`grid w-full grid-cols-[minmax(0,1fr)_2.5rem] gap-1 border-b border-gray-100 px-2 py-1 text-left text-xs ${
                l.id === locationId ? 'bg-blue-100 font-semibold' : 'hover:bg-blue-50'
              }`}
            >
              <span className="break-words text-gray-800">{l.name}</span>
              <span className="text-gray-600">{l.count}件</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {!selected ? (
          <p className="rounded-lg border border-panel-line bg-panel px-3 py-6 text-center text-sm text-gray-500">左の一覧から配送先を選んでください</p>
        ) : (
          <>
            {/* 「日付で見る」の「対象日: 11/18」と同じ見せ方（2026-11-17ユーザー指定） */}
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-gray-600">
                配送先: <span className="text-lg font-semibold text-gray-800">{selected.name}</span>
              </p>
              <span className="text-sm text-gray-600">今日以降の受付 {orders.length}件</span>
            </div>
            {message && (
              <div
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                  message.kind === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-700'
                }`}
              >
                {message.kind === 'ok' ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                {message.text}
              </div>
            )}
            <div className="overflow-hidden rounded-lg border border-panel-line bg-white">
              <div className="grid grid-cols-[minmax(0,1fr)_8rem_7rem_3.5rem] gap-2 border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
                <span>配送日</span>
                <span>到着の指定</span>
                <span>トラック</span>
                <span />
              </div>
              {orders.map(s => (
                <div key={s.id} className="border-b border-gray-100 last:border-b-0">
                  <div
                    className={`grid grid-cols-[minmax(0,1fr)_8rem_7rem_3.5rem] items-center gap-2 px-3 py-1.5 text-sm ${
                      editingId === s.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <span className={`text-gray-800 ${editingId === s.id ? 'font-bold' : ''}`}>{dayLabel(s.stopDate, today)}</span>
                    <span>
                      <ArrivalTag stop={s} />
                    </span>
                    <span className="truncate text-xs text-gray-600">
                      {s.route ? (
                        canManageTrucks ? (
                          <a href={`/plans/${s.route.id}`} className="text-blue-600 hover:underline" title="配送計画を開く">
                            {s.route.truck.plateNo}
                          </a>
                        ) : (
                          s.route.truck.plateNo
                        )
                      ) : (
                        '未割当'
                      )}
                    </span>
                    <span className="text-right">
                      {s.route ? (
                        <Lock className="ml-auto h-4 w-4 text-gray-400" aria-label="トラックに割当済みのため修正できません" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(editingId === s.id ? null : s.id);
                            setMessage(null);
                          }}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                        >
                          <Pencil className="h-3 w-3" />
                          {editingId === s.id ? '閉じる' : '編集'}
                        </button>
                      )}
                    </span>
                  </div>
                  {editingId === s.id && (
                    <EditOrder
                      key={`${s.id}-${s.version}`}
                      stop={s}
                      date={s.stopDate}
                      products={products}
                      onDone={async text => {
                        setEditingId(null);
                        setMessage({ kind: 'ok', text });
                        await Promise.all([load(), onChanged()]);
                      }}
                      onError={text => setMessage({ kind: 'ng', text })}
                    />
                  )}
                </div>
              ))}
              {orders.length === 0 && <p className="px-3 py-4 text-sm text-gray-500">この配送先の今日以降の受付はありません</p>}
            </div>
            <p className="text-xs text-gray-500">鍵の印の受付はトラックに割当済みのため、この画面では修正できません。</p>
          </>
        )}
      </div>
    </div>
  );
}

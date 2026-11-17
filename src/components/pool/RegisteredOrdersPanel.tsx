'use client';

// 荷物受付「登録内容の確認・修正」の一覧（2026-11-17作り直し）。選んだ日の受付を1件1行で並べ、
// 未割当の行は「編集」から荷物・到着の指定・配送日の変更と取り消しができる。トラックに割当済みの行は
// 修正できない（今までと同じ。配送管理者が配送計画の画面で未割当に戻してから）。
// 修正後の内容は新規の受付と同じ判定（修正中の受付自身を除いた状態に足せるか）をし、×なら保存できない
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, Pencil, Plus, Trash2, Calendar, Check, AlertTriangle } from 'lucide-react';
import { useDialog } from '@/components/ui/DialogProvider';
import { ArrivalSelect, TIME_PENDING } from '@/components/plans/PoolEditor';
import { DayRow, Day, Cell, COLUMN_LABELS, SELECTED_FIELD, dayLabel, hhmm, todayKey } from '@/components/pool/NewOrderPanel';
import { bandOfWindow, windowLabel } from '@/lib/timeBands';

type ApiPackage = { id: string; productId: string | null; name: string; width: number; depth: number; height: number };
export type RegisteredStop = {
  id: string;
  locationId: string;
  status: string;
  version: number;
  requestedArrivalTime: string | null;
  requestedWindowStart: string | null;
  requestedWindowEnd: string | null;
  isTimeFixed: boolean;
  location: { id: string; name: string };
  packages: ApiPackage[];
  route?: { id: string; truck: { plateNo: string }; driver: { name: string } } | null;
};
export type Product = { id: string; name: string; width: number; depth: number; height: number };
type Row = { key: string; productId: string; quantity: string };
// 編集欄で選んだ商品・数量は、編集中の配送先の行と同じ背景（薄い青）にし、太字・濃い青にはしない（2026-11-17ユーザー指定）
const EDIT_FIELD = 'border-gray-300 bg-blue-50 font-normal text-gray-800';

// 到着の指定の値（PoolEditorのArrivalSelectと同じ形：''／'band:AM'等／'HH:mm'／TIME_PENDING）
function arrivalValueOf(s: RegisteredStop): string {
  if (s.isTimeFixed && s.requestedArrivalTime) return hhmm(s.requestedArrivalTime);
  if (s.requestedWindowStart && s.requestedWindowEnd) {
    const band = bandOfWindow(s.requestedWindowStart, s.requestedWindowEnd);
    if (band) return `band:${band.key}`;
  }
  return '';
}

/** 到着の指定の値 → 判定に使う列のキーと、APIに送る指定 */
function arrivalOf(value: string): { key: string; mode: 'band' | 'time'; time?: string; choice: object } | null {
  if (/^\d{2}:\d{2}$/.test(value)) return { key: 'TIME', mode: 'time', time: value, choice: { kind: 'time', time: value } };
  if (value === TIME_PENDING) return null;
  if (value.startsWith('band:')) {
    const band = value.slice('band:'.length);
    return { key: band, mode: 'band', choice: { kind: 'band', band } };
  }
  return { key: 'NONE', mode: 'band', choice: { kind: 'none' } };
}

function rowsOf(pkgs: ApiPackage[]): Row[] {
  const rows: Row[] = [];
  const byProduct = new Map<string, Row>();
  for (const p of pkgs) {
    const key = p.productId ?? p.id;
    const r = byProduct.get(key);
    if (r) r.quantity = String(Number(r.quantity) + 1);
    else {
      const nr = { key: p.id, productId: p.productId ?? '', quantity: '1' };
      byProduct.set(key, nr);
      rows.push(nr);
    }
  }
  return rows;
}

export function ArrivalTag({ stop }: { stop: RegisteredStop }) {
  if (stop.isTimeFixed && stop.requestedArrivalTime) {
    return <span className="whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-600">{hhmm(stop.requestedArrivalTime)} 指定</span>;
  }
  if (stop.requestedWindowStart && stop.requestedWindowEnd) {
    return (
      <span className="whitespace-nowrap rounded bg-green-50 px-1.5 py-0.5 text-xs font-semibold text-green-700">
        {windowLabel(stop.requestedWindowStart, stop.requestedWindowEnd)}（目安）
      </span>
    );
  }
  return <span className="whitespace-nowrap rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-500">指定なし</span>;
}

export default function RegisteredOrdersPanel({
  date,
  stops,
  products,
  canManageTrucks,
  onChanged,
}: {
  date: string;
  stops: RegisteredStop[];
  products: Product[];
  canManageTrucks: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'ng'; text: string } | null>(null);

  // 日付を変えたら、編集中の行と結果の表示を閉じる
  useEffect(() => {
    setEditingId(null);
    setMessage(null);
  }, [date]);

  const sorted = useMemo(
    () => [...stops].sort((a, b) => Number(!!a.route) - Number(!!b.route) || a.location.name.localeCompare(b.location.name, 'ja')),
    [stops]
  );

  return (
    <div className="space-y-2">
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
        <div className="grid grid-cols-[minmax(0,1fr)_8rem_8rem_3.5rem] gap-2 border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
          <span>配送先</span>
          <span>到着の指定</span>
          <span>トラック</span>
          <span />
        </div>
        {sorted.length === 0 && <p className="px-3 py-4 text-sm text-gray-500">この日の受付はまだありません。新規の受付タブから受け付けてください。</p>}
        {sorted.map(s => (
          <div key={s.id} className="border-b border-gray-100 last:border-b-0">
            <div
              className={`grid grid-cols-[minmax(0,1fr)_8rem_8rem_3.5rem] items-center gap-2 px-3 py-1.5 text-sm ${
                editingId === s.id ? 'bg-blue-50' : ''
              }`}
            >
              <span className={`break-words text-gray-800 ${editingId === s.id ? 'font-bold' : ''}`}>{s.location.name}</span>
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
                date={date}
                products={products}
                onDone={async (text, kind = 'ok') => {
                  setEditingId(null);
                  setMessage({ kind, text });
                  await onChanged();
                }}
                onError={text => setMessage({ kind: 'ng', text })}
              />
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        鍵の印の行はトラックに割当済みのため、この画面では修正できません（配送管理者が配送計画の画面で未割当に戻すと修正できます）。
      </p>
    </div>
  );
}

export function EditOrder({
  stop,
  date,
  products,
  onDone,
  onError,
}: {
  stop: RegisteredStop;
  date: string;
  products: Product[];
  onDone: (text: string, kind?: 'ok' | 'ng') => Promise<void>;
  onError: (text: string) => void;
}) {
  const { confirmDialog } = useDialog();
  const [rows, setRows] = useState<Row[]>(() => rowsOf(stop.packages));
  const [arrival, setArrival] = useState(() => arrivalValueOf(stop));
  const [targetDate, setTargetDate] = useState(date);
  const [showMove, setShowMove] = useState(false);
  const [days, setDays] = useState<Day[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = todayKey();

  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const payload = useMemo(() => {
    const out: { productId: string; name: string; width: number; depth: number; height: number }[] = [];
    for (const r of rows) {
      const p = productById.get(r.productId);
      const qty = Number(r.quantity);
      if (!p || !Number.isInteger(qty) || qty < 1) continue;
      for (let i = 0; i < qty; i++) out.push({ productId: p.id, name: p.name, width: p.width, depth: p.depth, height: p.height });
    }
    return out;
  }, [rows, productById]);
  const arr = arrivalOf(arrival);

  // 修正後の内容で判定し直す（修正中の受付自身を除いた状態に足せるか）。配送日の変更の表もこの結果を使う
  const check = useCallback(async () => {
    if (!arr || payload.length === 0) {
      setDays(null);
      return;
    }
    setChecking(true);
    try {
      const res = await fetch('/api/pool/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: stop.locationId, packages: payload, mode: arr.mode, time: arr.time, excludeStopId: stop.id }),
      });
      const data = await res.json();
      setDays(res.ok ? data.days : null);
    } finally {
      setChecking(false);
    }
    // arrの中身はarrivalから決まるため、arrivalを依存にする
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrival, payload, stop.id, stop.locationId]);

  useEffect(() => {
    const id = setTimeout(check, 400);
    return () => clearTimeout(id);
  }, [check]);

  const targetCell: Cell | undefined = arr ? days?.find(d => d.date === targetDate)?.cells.find(c => c.key === arr.key) : undefined;
  const canSave = !!arr && payload.length > 0 && !!targetCell && (targetCell.status === 'ok' || targetCell.status === 'tight') && !busy;

  const save = async () => {
    if (!arr || !canSave) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pool/order/${stop.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: stop.version, date: targetDate, packages: payload, arrival: arr.choice }),
      });
      const data = await res.json();
      if (!res.ok) {
        onError(`${data.error ?? '保存できませんでした'}${data.reason ? `（${data.reason}）` : ''}`);
        await check();
        return;
      }
      await onDone(
        targetDate === date
          ? `${stop.location.name} の受付を修正しました`
          : `${stop.location.name} の受付を ${dayLabel(targetDate, today)} に移しました`
      );
    } finally {
      setBusy(false);
    }
  };

  const cancelOrder = async () => {
    if (!(await confirmDialog(`${stop.location.name} の受付を取り消します。元に戻せません。よろしいですか？`, { variant: 'danger', confirmLabel: '取り消す' }))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pool/order/${stop.id}?version=${stop.version}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        onError(data.error ?? '取り消せませんでした');
        return;
      }
      await onDone(`${stop.location.name} の受付を取り消しました`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-blue-100 bg-blue-50/60 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-gray-600">荷物</p>
          {rows.map(r => (
            <div key={r.key} className="flex items-center gap-1">
              <select
                value={r.productId}
                onChange={e => setRows(rs => rs.map(x => (x.key === r.key ? { ...x, productId: e.target.value } : x)))}
                className={`w-60 rounded border px-1 py-0.5 text-sm ${r.productId ? EDIT_FIELD : 'border-gray-300 bg-white'}`}
              >
                <option value="">商品を選択</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}（{p.width}×{p.depth}×{p.height}m）
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                step={1}
                value={r.quantity}
                onChange={e => setRows(rs => rs.map(x => (x.key === r.key ? { ...x, quantity: e.target.value } : x)))}
                className={`w-14 rounded border px-1 py-0.5 text-sm ${r.productId ? EDIT_FIELD : 'border-gray-300 bg-white'}`}
                aria-label="数量"
              />
              <span className="text-xs text-gray-600">個</span>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}
                  className="text-gray-400 hover:text-red-600"
                  aria-label="この荷物を削除"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRows(rs => [...rs, { key: `r${Date.now()}`, productId: '', quantity: '1' }])}
            className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            <Plus className="h-3 w-3" />荷物を追加
          </button>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold text-gray-600">到着の指定</p>
          <ArrivalSelect value={arrival} disabled={busy} onChange={setArrival} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold text-gray-600">配送日</p>
          <p className="flex items-center gap-2">
            <span className={targetDate !== date ? `rounded border px-1.5 ${SELECTED_FIELD}` : ''}>{dayLabel(targetDate, today)}</span>
            <button
              type="button"
              onClick={() => setShowMove(v => !v)}
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              <Calendar className="h-3 w-3" />
              {showMove ? '日付の表を閉じる' : '配送日を変える'}
            </button>
          </p>
        </div>
      </div>

      {showMove && arr && days && (
        <div className="rounded border border-gray-200 bg-white p-2">
          <p className="mb-1 text-xs text-gray-600">移す日を選んでください（今の荷物・到着の指定で判定しています）</p>
          <div className="grid max-w-xl items-center gap-x-1 gap-y-0.5 text-xs" style={{ gridTemplateColumns: '7.5rem 4rem minmax(0, 1fr)' }}>
            <span />
            <span className="text-center text-gray-500">{arr.key === 'TIME' ? arr.time : COLUMN_LABELS[arr.key]}</span>
            <span className="text-gray-500">受け付けられない理由</span>
            {days.map(day => (
              <DayRow
                key={day.date}
                day={day}
                label={dayLabel(day.date, today)}
                columns={[arr.key]}
                selected={{ date: targetDate, key: arr.key }}
                peek={null}
                onPick={(_key, cell) => {
                  if (cell.status === 'ok' || cell.status === 'tight') setTargetDate(day.date);
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs">
          {!arr ? (
            <span className="text-gray-500">時刻を入れてください</span>
          ) : payload.length === 0 ? (
            <span className="text-gray-500">荷物を入れてください</span>
          ) : checking || !days ? (
            <span className="text-gray-500">判定中...</span>
          ) : targetCell && (targetCell.status === 'ok' || targetCell.status === 'tight') ? (
            <span className="text-green-700">
              ○ {dayLabel(targetDate, today)} で受け付けられます
              {targetCell.arrival && `（到着予定 ${hhmm(targetCell.arrival)}頃）`}
              {targetCell.status === 'tight' && <span className="text-amber-700">　余裕が少なめです</span>}
            </span>
          ) : (
            <span className="text-red-600">× この内容では受け付けられません{targetCell?.reason ? `：${targetCell.reason}` : ''}</span>
          )}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={cancelOrder}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded border border-red-300 bg-white px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          <Trash2 className="h-3 w-3" />受付を取り消す
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="rounded bg-blue-600 px-4 py-1 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
        >
          {busy ? '保存中...' : '変更を保存'}
        </button>
      </div>
    </div>
  );
}

'use client';

// 荷物受付「新規の受付」（2026-11-16導入）。電話で1件ずつ受け付ける画面：
// ①配送先を一覧から選ぶ → ②荷物を入れる → ③日付×到着の指定（指定なし／時間帯（目安）／時刻指定）の
// ○△×から枠を選ぶ → 受け付ける。対象日を先に選ぶ今までの入力（登録内容の確認・修正）とは別のタブ。
// ×は選べない（2026-11-16決定）。保存の直前にサーバーがもう一度判定し、×になっていれば保存しない
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, Trash2, AlertTriangle, Info, X } from 'lucide-react';
import { TIME_BANDS } from '@/lib/timeBands';

type Location = { id: string; name: string; address: string; phone: string | null; createdAt: string };
type Product = { id: string; name: string; width: number; depth: number; height: number };
type Recent = { locationId: string; lastCreatedAt: string | null; lastStopDate: string | null };
type PackageRow = { key: string; productId: string; quantity: string };
export type Cell = {
  key: string;
  status: 'ok' | 'tight' | 'ng' | 'no-truck' | 'registered';
  reason: string | null;
  arrival: string | null;
  finishTime: string | null;
};
export type Day = { date: string; stopCount: number; truckCount: number; cells: Cell[] };
type SortMode = 'recent' | 'name' | 'created';
// 到着の指定の選び方。none＝指定なし（最初はこれ。なるべく指定なしで受けたい、2026-11-17ユーザー指定）、
// band＝時間帯（目安）で選ぶ、time＝時刻を指定する
type Mode = 'none' | 'band' | 'time';
const MODE_LABELS: Record<Mode, string> = { none: '指定なし', band: '時間帯で選ぶ', time: '時刻を指定する' };

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
// 選び済みの見せ方（①の配送先名・②の商品と数量）。一覧の選択行（bg-blue-100）と同じ薄い青
export const SELECTED_CHIP = 'rounded-md border border-blue-300 bg-blue-100 px-2.5 py-0.5 text-sm font-bold text-blue-900';
export const SELECTED_FIELD = 'border-blue-300 bg-blue-100 font-bold text-blue-900';
const SORT_STORAGE_KEY = 'pool-new-order-sort';
export const COLUMN_LABELS: Record<string, string> = {
  NONE: '指定なし',
  ...Object.fromEntries(TIME_BANDS.map(b => [b.key, `${b.label}（目安）`])),
};

export function dayLabel(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const w = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}（${w}）${date === today ? ' 今日' : ''}`;
}

export function hhmm(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

export function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

function shortDate(date: string | null): string {
  if (!date) return '—';
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

export function arrivalText(key: string, time: string): string {
  if (key === 'TIME') return `${time} 時間指定（ちょうど）`;
  if (key === 'NONE') return '到着の指定なし';
  return `${COLUMN_LABELS[key]}`;
}

export const STATUS_MARK: Record<Cell['status'], string> = { ok: '○', tight: '△', ng: '×', 'no-truck': '—', registered: '—' };
export const STATUS_CLASS: Record<Cell['status'], string> = {
  ok: 'border-gray-200 bg-white text-green-700 hover:border-gray-400',
  tight: 'border-gray-200 bg-white text-amber-600 hover:border-gray-400',
  ng: 'border-dashed border-red-200 bg-gray-50 text-red-600',
  'no-truck': 'border-gray-200 bg-gray-50 text-gray-400 cursor-default',
  registered: 'border-gray-200 bg-gray-50 text-gray-400 cursor-default',
};

export default function NewOrderPanel({
  onRegistered,
  onShowDay,
}: {
  onRegistered?: () => void;
  /** 受付完了の表示の「この日の受付を見る」から、確認・修正タブのその日へ移る */
  onShowDay?: (date: string) => void;
}) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [recentByLocation, setRecentByLocation] = useState<Map<string, Recent>>(new Map());
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [location, setLocation] = useState<Location | null>(null);
  const [rows, setRows] = useState<PackageRow[]>([{ key: 'r0', productId: '', quantity: '1' }]);
  const [mode, setMode] = useState<Mode>('none');
  // 指定なし・時間帯は同じ計算結果（指定なし＋3つの時間帯）を使うので、切り替えても計算し直さない
  const apiMode: 'band' | 'time' = mode === 'time' ? 'time' : 'band';
  const [time, setTime] = useState('10:00');
  const [days, setDays] = useState<Day[] | null>(null);
  const [loadingDays, setLoadingDays] = useState(false);
  const [daysError, setDaysError] = useState('');
  const [selected, setSelected] = useState<{ date: string; key: string } | null>(null);
  const [peek, setPeek] = useState<{ date: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // 受付の結果。受け付けたときは「受け付けました」／配送先と日時・到着の指定／商品（1行ずつ）を③の下に大きめに出す
  // （2026-11-17ユーザー指定）。受け付けられなかったときは理由の文
  const [message, setMessage] = useState<
    | { kind: 'ok'; date: string; locationName: string; when: string; arrival: string | null; items: string[]; volume: number }
    | { kind: 'ng'; text: string }
    | null
  >(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(480);
  const today = todayKey();

  const loadRecent = useCallback(async () => {
    const res = await fetch('/api/pool/recent-locations');
    if (!res.ok) return;
    const data: Recent[] = await res.json();
    setRecentByLocation(new Map(data.map(r => [r.locationId, r])));
  }, []);

  useEffect(() => {
    fetch('/api/locations').then(r => r.json()).then((d: Location[]) => setLocations(Array.isArray(d) ? d : []));
    fetch('/api/products').then(r => r.json()).then((d: Product[]) => setProducts(Array.isArray(d) ? d : []));
    loadRecent();
    try {
      const saved = localStorage.getItem(SORT_STORAGE_KEY);
      if (saved === 'recent' || saved === 'name' || saved === 'created') setSortMode(saved);
    } catch {
      // 保存できない環境では最初の並び順のまま
    }
  }, [loadRecent]);

  // 画面全体をスクロールなしで収める（2026-11-16ユーザー指摘）。この画面の高さを画面の下端までにし、
  // 左の配送先一覧はその中で伸び縮みする（一覧の中だけスクロール）
  useLayoutEffect(() => {
    const update = () => {
      const top = listRef.current?.getBoundingClientRect().top ?? 0;
      setListHeight(Math.max(360, window.innerHeight - top - 24));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const changeSort = (m: SortMode) => {
    setSortMode(m);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, m);
    } catch {
      // 保存できなくても並び替え自体はできる
    }
  };

  const visibleLocations = useMemo(() => {
    const q = search.trim();
    const filtered = q
      ? locations.filter(l => l.name.includes(q) || l.address.includes(q) || (l.phone ?? '').includes(q))
      : locations;
    const sorted = [...filtered];
    if (sortMode === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    else if (sortMode === 'created') sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else {
      const key = (l: Location) => recentByLocation.get(l.id)?.lastCreatedAt ?? '';
      const day = (l: Location) => recentByLocation.get(l.id)?.lastStopDate ?? '';
      sorted.sort((a, b) => key(b).localeCompare(key(a)) || day(b).localeCompare(day(a)) || b.createdAt.localeCompare(a.createdAt));
    }
    return sorted;
  }, [locations, search, sortMode, recentByLocation]);

  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const packagePayload = useMemo(() => {
    const out: { productId: string; name: string; width: number; depth: number; height: number }[] = [];
    for (const r of rows) {
      const p = productById.get(r.productId);
      const qty = Number(r.quantity);
      if (!p || !Number.isInteger(qty) || qty < 1) continue;
      for (let i = 0; i < qty; i++) out.push({ productId: p.id, name: p.name, width: p.width, depth: p.depth, height: p.height });
    }
    return out;
  }, [rows, productById]);
  const totalVolume = packagePayload.reduce((s, p) => s + p.width * p.depth * p.height, 0);
  const timeValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const ready = !!location && packagePayload.length > 0 && (mode !== 'time' || timeValid);

  const loadAvailability = useCallback(async () => {
    if (!location || packagePayload.length === 0 || (apiMode === 'time' && !timeValid)) {
      setDays(null);
      return;
    }
    setLoadingDays(true);
    setDaysError('');
    try {
      const res = await fetch('/api/pool/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: location.id, packages: packagePayload, mode: apiMode, time: apiMode === 'time' ? time : undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDaysError(data.error ?? '空き状況を計算できませんでした');
        setDays(null);
      } else {
        setDays(data.days);
      }
    } catch {
      setDaysError('空き状況を計算できませんでした');
    } finally {
      setLoadingDays(false);
    }
  }, [location, packagePayload, apiMode, time, timeValid]);

  // 入力が変わったら少し待ってから計算し直す（数量や時刻を打っている途中で何度も計算しないため）
  useEffect(() => {
    setSelected(null);
    setPeek(null);
    const id = setTimeout(loadAvailability, 400);
    return () => clearTimeout(id);
  }, [loadAvailability]);

  const reset = () => {
    setLocation(null);
    setSearch('');
    setRows([{ key: `r${Date.now()}`, productId: '', quantity: '1' }]);
    setMode('none');
    setSelected(null);
    setPeek(null);
    setDays(null);
  };

  const selectedCell = selected && days?.find(d => d.date === selected.date)?.cells.find(c => c.key === selected.key);
  const peekCell = peek && days?.find(d => d.date === peek.date)?.cells.find(c => c.key === peek.key);

  const submit = async () => {
    if (!location || !selected || busy) return;
    setBusy(true);
    setMessage(null);
    const arrival =
      selected.key === 'TIME'
        ? { kind: 'time', time }
        : selected.key === 'NONE'
          ? { kind: 'none' }
          : { kind: 'band', band: selected.key };
    try {
      const res = await fetch('/api/pool/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selected.date, locationId: location.id, packages: packagePayload, arrival }),
      });
      const data = await res.json();
      const what = `${dayLabel(selected.date, today)} ${arrivalText(selected.key, time)}`;
      if (res.status === 409) {
        setMessage({
          kind: 'ng',
          text: `他の受付が先に入ったため、${what} では受け付けられなくなりました${data.reason ? `（${data.reason}）` : ''}。表を最新にしたので、もう一度選んでください。`,
        });
        await loadAvailability();
        return;
      }
      if (!res.ok) {
        setMessage({ kind: 'ng', text: data.error ?? '受け付けられませんでした' });
        return;
      }
      setMessage({
        kind: 'ok',
        date: selected.date,
        locationName: location.name,
        when: what,
        arrival: data.arrival ?? null,
        items: rows
          .filter(r => productById.get(r.productId) && Number(r.quantity) >= 1)
          .map(r => {
            const p = productById.get(r.productId)!;
            return `${p.name}（${p.width}×${p.depth}×${p.height}m） × ${r.quantity}個`;
          }),
        volume: totalVolume,
      });
      reset();
      loadRecent();
      onRegistered?.();
    } catch {
      setMessage({ kind: 'ng', text: '受け付けられませんでした（通信に失敗しました）' });
    } finally {
      setBusy(false);
    }
  };

  const columns = mode === 'band' ? TIME_BANDS.map(b => b.key) : mode === 'time' ? ['TIME'] : ['NONE'];
  // 列が1つ（指定なし・時刻指定）のときは、右に受け付けられない理由を並べる
  const single = columns.length === 1;

  // 画面全体をスクロールなしで収めるため、広い画面（1024px〜）では左に配送先の一覧、右に荷物・日付の表・確認を並べる。
  // 一覧は選んだ後も畳まず（選んだ行を青く表示）、右側だけで残りの入力を進める
  return (
    <div
      ref={listRef}
      className="grid gap-3 lg:h-[var(--panel-h)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      style={{ '--panel-h': `${listHeight}px` } as React.CSSProperties}
    >
      {/* ① 配送先 */}
      <section className="flex min-h-0 flex-col rounded-lg border border-panel-line bg-white p-3">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-heading">
          <StepNo n={1} done={!!location} />配送先
          {location && (
            // 選んだ配送先は一覧の選択行と同じ薄い青の札で出す（②の選んだ商品と同じ見せ方。2026-11-17ユーザー選択の案2）
            <span className="ml-1 flex min-w-0 items-center">
              <span className={`truncate ${SELECTED_CHIP}`}>{location.name}</span>
            </span>
          )}
        </h2>
        <>
            <div className="mb-1 flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="名前・住所・電話番号の一部"
                  className="w-full rounded border border-gray-300 py-1 pl-2 pr-7 text-sm"
                />
                {/* 検索の文字を消す×（2026-11-17ユーザー指定） */}
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    aria-label="検索の文字を消す"
                    title="検索の文字を消す"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <select
                value={sortMode}
                onChange={e => changeSort(e.target.value as SortMode)}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="recent">表示順: 最近受け付けた順</option>
                <option value="name">表示順: 名前順</option>
                <option value="created">表示順: 登録順</option>
              </select>
            </div>
            <p className="mb-1 text-xs text-gray-500">
              {search.trim() ? `「${search.trim()}」に一致 ${visibleLocations.length}件` : `${locations.length}件`}
              　一覧に無い配送先は、システム管理者に登録を依頼してください
            </p>
            <div className="max-h-[60vh] min-h-0 flex-1 overflow-y-auto rounded border border-gray-300 lg:max-h-none">
              <div className="sticky top-0 grid grid-cols-[minmax(0,1fr)_7.5rem_3.5rem] gap-2 border-b border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-500">
                <span>配送先</span>
                <span>電話番号</span>
                <span>最後の配送</span>
              </div>
              {visibleLocations.map(l => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    setLocation(l);
                    // 次の受付を始めたら、前の受付の結果は消す（③の表を出す場所を空ける）
                    setMessage(null);
                  }}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_7.5rem_3.5rem] gap-2 border-b border-gray-100 px-2 py-1 text-left text-xs ${
                    location?.id === l.id ? 'bg-blue-100 font-semibold' : 'hover:bg-blue-50'
                  }`}
                >
                  {/* 住所は出さず、配送先名を省略せずに表示する（2026-11-17ユーザー指定。住所でも検索はできる） */}
                  <span className="break-words text-gray-800">{l.name}</span>
                  <span className="truncate text-gray-600">{l.phone ?? ''}</span>
                  <span className="text-gray-500">{shortDate(recentByLocation.get(l.id)?.lastStopDate ?? null)}</span>
                </button>
              ))}
            </div>
        </>
      </section>

      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">

      {/* ② 荷物 */}
      <section className={`rounded-lg border border-panel-line bg-white px-3 py-2 ${location ? '' : 'pointer-events-none opacity-50'}`}>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-heading">
          <StepNo n={2} done={packagePayload.length > 0} />荷物
          <span className="ml-auto flex items-center gap-3 text-xs font-normal">
            <button
              type="button"
              onClick={() => setRows(rs => [...rs, { key: `r${Date.now()}`, productId: '', quantity: '1' }])}
              className="flex items-center gap-1 text-blue-600 hover:underline"
            >
              <Plus className="h-3 w-3" />荷物を追加
            </button>
            <span className="text-gray-500">合計 {totalVolume.toFixed(2)}m3</span>
          </span>
        </h2>
        <div className="space-y-1">
          {rows.map(r => (
            <div key={r.key} className="flex items-center gap-2">
              <select
                value={r.productId}
                onChange={e => setRows(rs => rs.map(x => (x.key === r.key ? { ...x, productId: e.target.value } : x)))}
                className={`min-w-0 flex-1 rounded border px-2 py-1 text-sm ${r.productId ? SELECTED_FIELD : 'border-gray-300'}`}
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
                className={`w-16 rounded border px-2 py-1 text-sm ${r.productId ? SELECTED_FIELD : 'border-gray-300'}`}
                aria-label="数量"
              />
              <span className="text-sm text-gray-600">個</span>
              <button
                type="button"
                onClick={() => setRows(rs => (rs.length > 1 ? rs.filter(x => x.key !== r.key) : rs))}
                className="text-gray-400 hover:text-red-600"
                aria-label="この荷物を削除"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ③ 配送日と到着の指定 */}
      <section className={`rounded-lg border border-panel-line bg-white px-3 py-2 ${location && packagePayload.length > 0 ? '' : 'pointer-events-none opacity-50'}`}>
        <h2 className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-heading">
          <StepNo n={3} done={!!selectedCell} />配送日と到着の指定
          <span className="ml-auto inline-flex overflow-hidden rounded border border-gray-300 text-xs font-normal">
            {(['none', 'band', 'time'] as Mode[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setSelected(null);
                  setPeek(null);
                }}
                className={`border-l border-gray-300 px-2 py-0.5 first:border-l-0 ${mode === m ? 'bg-blue-100 font-bold text-blue-900' : 'bg-white text-gray-600'}`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </span>
        </h2>
        {mode === 'time' && (
          <div className="mb-1 flex items-center gap-2 text-sm">
            到着時刻
            <input type="time" value={time} onChange={e => setTime(e.target.value)} className="rounded border border-gray-300 px-2 py-0.5 text-sm" />
            <span className="text-xs text-gray-500">ちょうどに着く必要がある場合だけ</span>
          </div>
        )}

        {daysError && <p className="text-sm text-red-600">{daysError}</p>}
        {!days ? (
          <p className="text-sm text-gray-500">{loadingDays ? '計算中...' : '配送先と荷物を入れると、空き状況が出ます'}</p>
        ) : (
          <div className={loadingDays ? 'opacity-60' : ''}>
            <div
              className="grid items-center gap-x-1 gap-y-0.5 text-xs"
              style={{ gridTemplateColumns: single ? '7.5rem 4rem minmax(0, 1fr)' : `7.5rem repeat(${columns.length}, minmax(0, 1fr))` }}
            >
              <span />
              {columns.map(k => (
                <span key={k} className="text-center text-gray-500">
                  {k === 'TIME' ? time : COLUMN_LABELS[k]}
                </span>
              ))}
              {single && <span className="text-gray-500">受け付けられない理由</span>}
              {days.map(day => (
                <DayRow
                  key={day.date}
                  day={day}
                  label={dayLabel(day.date, today)}
                  columns={columns}
                  selected={selected}
                  peek={peek}
                  onPick={(key, cell) => {
                    if (cell.status === 'ok' || cell.status === 'tight') {
                      setSelected({ date: day.date, key });
                      setPeek(null);
                    } else if (cell.status === 'ng') {
                      setPeek({ date: day.date, key });
                      setSelected(null);
                    }
                  }}
                />
              ))}
            </div>
            <p
              className="mt-1 text-xs text-gray-500"
              title={mode === 'band' ? '時間帯はその中に着く目安です（後の追加で超えることもあります）' : undefined}
            >
              {mode === 'band'
                ? '○余裕あり　△余裕少　×不可（押すと理由）　—トラック未登録など'
                : mode === 'time'
                  ? '○その時刻に着ける　△余裕少　×不可　—トラック未登録など'
                  : '○余裕あり　△余裕少　×不可　—トラック未登録など'}
            </p>
            {peekCell && peek && (
              <div className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                <b>
                  {dayLabel(peek.date, today)} {arrivalText(peek.key, time)} は受け付けられません：
                </b>
                {peekCell.reason}
              </div>
            )}
            {selectedCell?.reason && (
              <div className="mt-1 flex items-start gap-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                {selectedCell.reason}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 受付の結果（③の下） */}
      {message?.kind === 'ok' && (
        // 配色は「保存しました」と同じ控えめな緑（2026-11-17ユーザーが5案からB案を選択）。中身は通常の濃い文字で読みやすく
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <p className="flex items-center gap-1.5 text-sm font-bold text-green-800">
            <Check className="h-4 w-4 shrink-0 text-green-600" />
            受け付けました
          </p>
          <p className="mt-1 text-base font-semibold text-heading">{message.locationName}</p>
          <p className="text-sm text-gray-700">
            {message.when}
            {message.arrival && `　到着予定 ${hhmm(message.arrival)}頃`}
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
            {message.items.map((item, i) => (
              <li key={i}>・{item}</li>
            ))}
          </ul>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-gray-500">
            <span>合計 {message.volume.toFixed(2)}m3　続けて次の受付ができます</span>
            {onShowDay && (
              <button type="button" onClick={() => onShowDay(message.date)} className="text-blue-600 hover:underline">
                この日の受付を見る →
              </button>
            )}
          </p>
        </div>
      )}
      {message?.kind === 'ng' && (
        <div className="flex items-start gap-2 rounded-lg border-2 border-red-400 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{message.text}</span>
        </div>
      )}

      {/* 確認と受付 */}
      <div className="mt-auto flex items-center gap-3">
        {ready && selected && selectedCell ? (
          // 確認の枠は落ち着いた灰色にし、青は「選んだもの」と受け付けるボタンだけにする（2026-11-17案B）
          <div className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-panel-line px-3 py-1.5 text-xs text-heading">
            <p className="truncate">
              <span className="font-semibold">この内容で受け付けます：{location!.name}</span>
              {rows
                .filter(r => productById.get(r.productId) && Number(r.quantity) >= 1)
                .map(r => `${productById.get(r.productId)!.name} × ${r.quantity}個`)
                .join('、')}
              （{totalVolume.toFixed(2)}m3）
            </p>
            <p className="font-semibold">
              {dayLabel(selected.date, today)}　{arrivalText(selected.key, time)}
              {selectedCell.arrival && <span className="font-normal text-gray-600">　到着予定 {hhmm(selectedCell.arrival)}頃</span>}
            </p>
          </div>
        ) : (
          <p className="flex-1 text-sm text-gray-500">
            {!location ? '配送先を選んでください' : packagePayload.length === 0 ? '荷物を入れてください' : '表から配送日を選んでください'}
          </p>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!ready || !selected || busy}
          className="shrink-0 rounded bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
        >
          {busy ? '受付中...' : '受け付ける'}
        </button>
      </div>
      </div>
    </div>
  );
}

// ステップの番号。まだのステップは灰色の番号、選び終えたステップは青い丸に✓（進み具合の印。2026-11-17ユーザー選択の案B）
function StepNo({ n, done }: { n: number; done: boolean }) {
  return done ? (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
      <Check className="h-3.5 w-3.5" strokeWidth={3} />
    </span>
  ) : (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-500">{n}</span>
  );
}

// 確認・修正タブ（RegisteredOrdersPanel）の配送日の変更でも同じ表を使う
export function DayRow({
  day,
  label,
  columns,
  selected,
  peek,
  onPick,
}: {
  day: Day;
  label: string;
  columns: string[];
  selected: { date: string; key: string } | null;
  peek: { date: string; key: string } | null;
  onPick: (key: string, cell: Cell) => void;
}) {
  const registered = day.cells.every(c => c.status === 'registered');
  const single = columns.length === 1;
  const cells = columns.map(k => day.cells.find(c => c.key === k)).filter((c): c is Cell => !!c);
  return (
    <>
      <span className="text-gray-700">
        {label}
        <span className="ml-1 text-gray-400">{day.stopCount}件</span>
      </span>
      {registered ? (
        <span
          className="rounded border border-gray-200 bg-gray-50 py-0 text-center leading-[18px] text-gray-400"
          style={{ gridColumn: `span ${single ? 2 : columns.length}` }}
        >
          この配送先はこの日に登録済み
        </span>
      ) : (
        <>
          {cells.map(c => {
            const isSel = selected?.date === day.date && selected.key === c.key;
            const isPeek = peek?.date === day.date && peek.key === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => onPick(c.key, c)}
                title={c.reason ?? undefined}
                className={`rounded border py-0 text-center text-sm leading-[18px] ${
                  // 選んだ枠は①②と同じ薄い青（2026-11-17ユーザー指定）
                  isSel ? SELECTED_FIELD : `${STATUS_CLASS[c.status]} ${isPeek ? 'ring-2 ring-red-300' : ''}`
                }`}
              >
                {STATUS_MARK[c.status]}
              </button>
            );
          })}
          {single && (
            <span className="truncate text-red-600" title={cells[0]?.status === 'ng' ? cells[0].reason ?? '' : ''}>
              {cells[0]?.status === 'ng' ? cells[0].reason : cells[0]?.status === 'no-truck' ? <span className="text-gray-400">トラック未登録</span> : ''}
            </span>
          )}
        </>
      )}
    </>
  );
}

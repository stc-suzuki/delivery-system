'use client';

import { useState } from 'react';
import { useDialog } from '@/components/ui/DialogProvider';

export type PoolLocation = { id: string; name: string; address: string; lat: number; lng: number };
export type PoolProduct = { id: string; name: string; width: number; depth: number; height: number };
export type PackageRow = { key: string; productId: string; name: string; width: string; depth: string; height: string; quantity: string };

// サーバーから返る荷物（Package）1件ずつの配列を、商品（productId）単位でまとめて
// quantity付きのPackageRowに変換する。保存時は毎回そのロケーションのPackageを
// 全削除→数量分だけ再作成する設計（/api/pool, /api/plans/[id]/optimize）のため、
// 表示側で商品ごとに集約しても個体IDの整合性を気にする必要はない。
export function groupPackagesByProduct(
  pkgs: { id: string; productId: string | null; name: string; width: number; depth: number; height: number }[]
): PackageRow[] {
  const rows: PackageRow[] = [];
  const rowIndexByProductId = new Map<string, number>();
  for (const p of pkgs) {
    const existingIndex = p.productId ? rowIndexByProductId.get(p.productId) : undefined;
    if (existingIndex !== undefined) {
      const existing = rows[existingIndex];
      existing.quantity = String(Number(existing.quantity) + 1);
      continue;
    }
    rows.push({
      key: p.id,
      productId: p.productId ?? '',
      name: p.name,
      width: String(p.width),
      depth: String(p.depth),
      height: String(p.height),
      quantity: '1',
    });
    if (p.productId) rowIndexByProductId.set(p.productId, rows.length - 1);
  }
  return rows;
}

// 配送先・荷物の選択UI（検索・チェックボックス・到着希望時刻・商品行）。
// /pool（日付スコープのプール登録画面）と plans/[id]（稼働中ルートへの配送先選択）の
// 両方から利用する共通コンポーネント。状態は呼び出し側が保持し、このコンポーネントは
// 表示とイベントの橋渡しに徹する。
export default function PoolEditor({
  locations,
  products,
  locSearch,
  onSearchChange,
  selectedLocationIds,
  arrivalTimes,
  packages,
  fixedLocationInfo,
  poolConflictInfo,
  editable,
  onToggleLocation,
  onUpdateArrivalTime,
  onAddPackage,
  onRemovePackage,
  onUpdatePackageProduct,
  onUpdatePackageQuantity,
  packageVolumeFor,
  confirmOnDeselect = false,
  listMaxHeightClassName = 'max-h-80',
}: {
  locations: PoolLocation[];
  products: PoolProduct[];
  locSearch: string;
  onSearchChange: (value: string) => void;
  selectedLocationIds: Set<string>;
  arrivalTimes: Record<string, string>;
  packages: Record<string, PackageRow[]>;
  fixedLocationInfo?: Map<string, 'COMPLETED' | 'SKIPPED'>;
  // 既に割当済み／分割済みでこの画面から編集できない配送先に表示する注意書き（locationId→ラベル文言）。
  // /api/pool のPUT側スキップ判定と同じ条件で計算し、保存を試みる前に気づけるようにする
  poolConflictInfo?: Map<string, string>;
  editable: boolean;
  onToggleLocation: (id: string) => void;
  onUpdateArrivalTime: (id: string, time: string) => void;
  onAddPackage: (locationId: string) => void;
  onRemovePackage: (locationId: string, key: string) => void;
  onUpdatePackageProduct: (locationId: string, key: string, productId: string) => void;
  onUpdatePackageQuantity: (locationId: string, key: string, quantity: string) => void;
  packageVolumeFor: (locationId: string) => number;
  // 選択済みの配送先のチェックを外そうとした際に確認ダイアログを出すかどうか。
  // 入力済みの到着希望時刻・荷物情報が失われる操作のため、/pool画面でのみ有効にする
  confirmOnDeselect?: boolean;
  // 配送先一覧のスクロール枠の高さ（Tailwindのmax-hクラス）。呼び出し画面のレイアウトに合わせて調整できるように
  listMaxHeightClassName?: string;
}) {
  const [sortMode, setSortMode] = useState<'default' | 'name' | 'selected'>('default');
  const { confirmDialog } = useDialog();

  let filteredLocations = locations.filter(l => l.name.includes(locSearch) || l.address.includes(locSearch));
  if (sortMode === 'name') {
    filteredLocations = [...filteredLocations].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  } else if (sortMode === 'selected') {
    const selectionOrder = new Map(Array.from(selectedLocationIds).map((id, i) => [id, i]));
    filteredLocations = filteredLocations
      .filter(l => selectedLocationIds.has(l.id))
      .sort((a, b) => selectionOrder.get(a.id)! - selectionOrder.get(b.id)!);
  }

  async function handleToggle(loc: PoolLocation, selected: boolean) {
    if (selected && confirmOnDeselect) {
      if (
        !(await confirmDialog(`「${loc.name}」の選択を解除しますか？入力した到着希望時刻・荷物の登録内容は削除されます。`, {
          variant: 'danger',
          confirmLabel: '解除する',
        }))
      ) {
        return;
      }
    }
    onToggleLocation(loc.id);
  }

  async function handleRemovePackage(locationId: string, p: PackageRow) {
    const message = p.name ? `「${p.name}」を削除しますか？` : 'この荷物を削除しますか？';
    if (!(await confirmDialog(message, { variant: 'danger' }))) return;
    onRemovePackage(locationId, p.key);
  }

  return (
    <div>
      <div className="mb-2 flex gap-2">
        <input
          placeholder="検索"
          value={locSearch}
          onChange={e => onSearchChange(e.target.value)}
          className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <select
          value={sortMode}
          onChange={e => setSortMode(e.target.value as typeof sortMode)}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="default">表示順: 登録順</option>
          <option value="name">表示順: 名前順</option>
          <option value="selected">表示順: 選択した順</option>
        </select>
      </div>
      <p className="mb-2 text-xs text-[#4B5563]">
        到着希望時刻を入力した配送先は最優先で順序付けされます。未入力の配送先はルート最適化により自動配置されます。
      </p>
      <div className={`${listMaxHeightClassName} space-y-1 overflow-y-auto`}>
        {filteredLocations.map(loc => {
          const selected = selectedLocationIds.has(loc.id);
          const fixed = fixedLocationInfo?.get(loc.id);
          const conflict = poolConflictInfo?.get(loc.id);
          const locPackages = packages[loc.id] ?? [];
          return (
            <div key={loc.id} className="rounded text-sm">
              <div className="flex items-center gap-2">
                <label className="flex flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={!editable || !!fixed || !!conflict}
                    onChange={() => handleToggle(loc, selected)}
                    title={conflict}
                  />
                  <span className="truncate">{loc.name}</span>
                  {fixed && (
                    <span className={`shrink-0 text-xs ${fixed === 'COMPLETED' ? 'text-green-600' : 'text-[#4B5563]'}`}>
                      {fixed === 'COMPLETED' ? '配達済み' : 'スキップ済み'}
                    </span>
                  )}
                  {conflict && (
                    <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                      {conflict}
                    </span>
                  )}
                </label>
                {selected && (
                  <input
                    type="time"
                    disabled={!editable || !!fixed || !!conflict}
                    value={arrivalTimes[loc.id] ?? ''}
                    onChange={e => onUpdateArrivalTime(loc.id, e.target.value)}
                    className={`rounded border px-1 py-0.5 text-xs ${
                      arrivalTimes[loc.id] ? 'border-red-300 bg-red-50' : 'border-gray-300'
                    }`}
                  />
                )}
              </div>
              {selected && (
                <div className="ml-6 mt-1 space-y-1 border-l border-gray-100 pl-2">
                  {locPackages.map(p => (
                    <div key={p.key} className="flex items-center gap-1">
                      <select
                        value={p.productId}
                        disabled={!editable || !!fixed || !!conflict}
                        onChange={e => onUpdatePackageProduct(loc.id, p.key, e.target.value)}
                        className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                      >
                        <option value="">商品を選択</option>
                        {products.map(pr => (
                          <option key={pr.id} value={pr.id}>
                            {pr.name}（{pr.width}×{pr.depth}×{pr.height}m）
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={p.quantity}
                        disabled={!editable || !!fixed || !!conflict}
                        onChange={e => onUpdatePackageQuantity(loc.id, p.key, e.target.value)}
                        className="w-14 rounded border border-gray-300 px-1 py-0.5 text-xs"
                        title="数量"
                      />
                      <span className="text-xs text-[#4B5563]">個</span>
                      {editable && !fixed && !conflict && (
                        <button
                          type="button"
                          onClick={() => handleRemovePackage(loc.id, p)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          削除
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    {editable && !fixed && !conflict && (
                      <button
                        type="button"
                        onClick={() => onAddPackage(loc.id)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        + 荷物を追加
                      </button>
                    )}
                    {locPackages.length > 0 && (
                      <span className="text-xs text-[#4B5563]">合計体積: {packageVolumeFor(loc.id).toFixed(2)}m3</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

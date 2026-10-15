// トラック1台に割り当てられた荷物（Package）の体積合計が、
// トラックの容積上限（capacityM3）を超えていないか、また個々の荷物の寸法が
// トラックの荷台サイズ（bedWidth/bedDepth/bedHeight）に物理的に収まるかを確認する純粋関数群。
// いずれも警告のみ（案C）で、既存の地理クラスタリング・トラック割当ロジックは変更しない。

export interface Dimensions {
  width: number;
  depth: number;
  height: number;
}

/**
 * 荷物がトラックの荷台に物理的に収まるかどうかの簡易チェック。
 * 3辺を昇順に並べて比較するだけで判定する（＝向きを変えて置くことは許容するが、
 * 実際にどこにどう置くか＝3D配置計算までは行わない中間案）。
 * 検証用プロジェクト（binPacking.ts）のfitsBedと同じロジック。
 */
export function fitsBed(pkg: Dimensions, bed: Dimensions): boolean {
  const p = [pkg.width, pkg.depth, pkg.height].sort((a, b) => a - b);
  const t = [bed.width, bed.depth, bed.height].sort((a, b) => a - b);
  return p[0] <= t[0] && p[1] <= t[1] && p[2] <= t[2];
}

export interface CapacityCheckResult {
  /** 割り当てられた停車地の積み荷体積合計（m3） */
  totalVolume: number;
  /** トラックの容積上限を超えているか（capacityM3が未設定の場合は常にfalse） */
  overCapacity: boolean;
  /** 超過分（m3）。超過していない場合は0 */
  overBy: number;
}

export function truckBed(
  truck: { bedWidth: number | null; bedDepth: number | null; bedHeight: number | null } | null | undefined
): Dimensions | null {
  if (!truck || truck.bedWidth == null || truck.bedDepth == null || truck.bedHeight == null) return null;
  return { width: truck.bedWidth, depth: truck.bedDepth, height: truck.bedHeight };
}

/** 荷台の物理容積（幅×奥行き×高さ）。荷台寸法が揃っていなければnull */
export function bedVolume(bed: Dimensions | null): number | null {
  if (!bed) return null;
  return bed.width * bed.depth * bed.height;
}

/**
 * トラック登録・更新時の荷台寸法を検証し、容積上限（capacityM3）を荷台の物理容積から求める。
 * 容積上限は手入力させず常に荷台寸法から計算する（積み込み時の隙間によるゆとりは、
 * システム設定の積載利用率で全トラック一括に持たせる）。荷台寸法はいずれも必須で、0より大きい数値
 */
export function resolveTruckBed(
  input: { bedWidth: unknown; bedDepth: unknown; bedHeight: unknown }
): { bed: Dimensions; capacityM3: number } | { error: string } {
  const values = [input.bedWidth, input.bedDepth, input.bedHeight].map(v =>
    v === null || v === undefined || v === '' ? NaN : Number(v)
  );
  if (values.some(v => !Number.isFinite(v) || v <= 0)) {
    return { error: '荷台の幅・奥行き・高さは必須です（0より大きい数値、m単位）' };
  }
  const [width, depth, height] = values;
  // 1.8×4.3×1のような掛け算で生じる浮動小数点の端数を落とす
  const capacityM3 = Math.round(width * depth * height * 1000) / 1000;
  return { bed: { width, depth, height }, capacityM3 };
}

/**
 * 積載利用率（システム設定、%）を踏まえた実効の容積上限。積み込み時の隙間（デッドスペース）を
 * 考慮し、AI提案・積載率表示・容積超過の警告・荷物受付の見込みのすべてでこの値を上限として使う。
 * 容積上限が未設定のトラック（荷台寸法を必須にする前のデータ）は従来どおり制約なし（null）
 */
export function effectiveCapacityM3(capacityM3: number | null | undefined, loadUtilizationPercent: number): number | null {
  if (capacityM3 == null) return null;
  return capacityM3 * (loadUtilizationPercent / 100);
}

export function checkCapacityOverflow(
  capacityM3: number | null | undefined,
  stopVolumes: Array<number | null | undefined>
): CapacityCheckResult {
  const totalVolume = stopVolumes.reduce((sum: number, v) => sum + (v ?? 0), 0);

  if (capacityM3 == null) {
    return { totalVolume, overCapacity: false, overBy: 0 };
  }

  const overBy = totalVolume - capacityM3;
  return {
    totalVolume,
    overCapacity: overBy > 0,
    overBy: Math.max(overBy, 0),
  };
}

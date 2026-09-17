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

/** capacityM3が荷台の物理容積を超えている場合、荷台容積に補正する */
export function clampCapacityToBed(
  capacityM3: number | null | undefined,
  bed: Dimensions | null
): number | null | undefined {
  if (capacityM3 == null) return capacityM3;
  const maxVolume = bedVolume(bed);
  if (maxVolume == null) return capacityM3;
  return Math.min(capacityM3, maxVolume);
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

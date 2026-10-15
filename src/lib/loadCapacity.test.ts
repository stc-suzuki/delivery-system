import { describe, expect, it } from 'vitest';
import { bedVolume, checkCapacityOverflow, effectiveCapacityM3, fitsBed, resolveTruckBed, truckBed } from './loadCapacity';

// 2tトラック相当の荷台（幅1.6m・奥行き3.0m・高さ1.8m）
const bed = { width: 1.6, depth: 3.0, height: 1.8 };

describe('fitsBed（向きを変えれば荷台に入るか）', () => {
  it('そのままの向きで入る荷物は入る', () => {
    expect(fitsBed({ width: 1, depth: 1, height: 1 }, bed)).toBe(true);
  });

  it('向きを変えれば入る荷物は入る（長い辺を奥行きに合わせる）', () => {
    expect(fitsBed({ width: 2.9, depth: 1.0, height: 1.0 }, bed)).toBe(true);
  });

  it('荷台の寸法ちょうどの荷物は入る', () => {
    expect(fitsBed({ width: 1.6, depth: 3.0, height: 1.8 }, bed)).toBe(true);
  });

  it('体積は小さくても、どの向きでも長さが収まらない荷物は入らない（配管資材の例）', () => {
    expect(fitsBed({ width: 1, depth: 1, height: 3.3 }, bed)).toBe(false);
  });

  it('2辺が荷台より大きい荷物は入らない（特大クレートの例）', () => {
    expect(fitsBed({ width: 2.5, depth: 2.5, height: 1 }, bed)).toBe(false);
  });
});

describe('truckBed（トラックの荷台寸法）', () => {
  it('3辺そろっていれば寸法を返す', () => {
    expect(truckBed({ bedWidth: 1.6, bedDepth: 3, bedHeight: 1.8 })).toEqual({ width: 1.6, depth: 3, height: 1.8 });
  });

  it('1辺でも未設定なら判定しない（null）', () => {
    expect(truckBed({ bedWidth: 1.6, bedDepth: null, bedHeight: 1.8 })).toBeNull();
    expect(truckBed(null)).toBeNull();
  });
});

describe('resolveTruckBed（荷台寸法の検証と容積上限の計算）', () => {
  it('容積上限は荷台の物理容積（幅×奥行き×高さ）。浮動小数点の端数は落とす', () => {
    expect(bedVolume(bed)).toBeCloseTo(8.64);
    expect(resolveTruckBed({ bedWidth: 1.6, bedDepth: 3.0, bedHeight: 1.8 })).toEqual({ bed, capacityM3: 8.64 });
    expect(resolveTruckBed({ bedWidth: '1.8', bedDepth: '4.3', bedHeight: '1' })).toEqual({
      bed: { width: 1.8, depth: 4.3, height: 1 },
      capacityM3: 7.74,
    });
  });

  it('荷台寸法が1つでも欠けている・0以下・数値でなければエラー', () => {
    for (const input of [
      { bedWidth: 1, bedDepth: 1, bedHeight: undefined },
      { bedWidth: 1, bedDepth: null, bedHeight: 1 },
      { bedWidth: '', bedDepth: 1, bedHeight: 1 },
      { bedWidth: 0, bedDepth: 1, bedHeight: 1 },
      { bedWidth: -1, bedDepth: 1, bedHeight: 1 },
      { bedWidth: 'abc', bedDepth: 1, bedHeight: 1 },
    ]) {
      expect(resolveTruckBed(input)).toHaveProperty('error');
    }
  });
});

describe('effectiveCapacityM3（積載利用率を踏まえた実効の容積上限）', () => {
  it('容積上限×積載利用率', () => {
    expect(effectiveCapacityM3(8, 100)).toBe(8);
    expect(effectiveCapacityM3(8, 85)).toBeCloseTo(6.8);
  });

  it('容積上限が未設定なら制約なし（null）', () => {
    expect(effectiveCapacityM3(null, 85)).toBeNull();
    expect(effectiveCapacityM3(undefined, 85)).toBeNull();
  });
});

describe('checkCapacityOverflow（容積超過の判定）', () => {
  it('合計が上限を超えれば超過とし、超過分を返す', () => {
    const result = checkCapacityOverflow(5, [3, 3, 3, 3]);
    expect(result.totalVolume).toBe(12);
    expect(result.overCapacity).toBe(true);
    expect(result.overBy).toBe(7);
  });

  it('上限ちょうどは超過ではない', () => {
    expect(checkCapacityOverflow(6, [3, 3]).overCapacity).toBe(false);
  });

  it('上限が未設定のトラックは判定しない', () => {
    const result = checkCapacityOverflow(null, [100]);
    expect(result.overCapacity).toBe(false);
    expect(result.overBy).toBe(0);
  });

  it('体積が未設定の停車地は0として数える', () => {
    expect(checkCapacityOverflow(5, [2, null, undefined, 2]).totalVolume).toBe(4);
  });
});

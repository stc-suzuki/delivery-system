import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// planEditPolicy.ts はDB接続（./prisma）も読み込むため、テストでは空のものに差し替える
vi.mock('./prisma', () => ({ prisma: {} }));

import { DayCapacity, dayStatusKind } from './capacityOverviewStatus';
import { canEditRoute, getEditWarning } from './planEditPolicy';
import { computeRouteOperationStatus } from './routeOperationStatus';

describe('computeRouteOperationStatus（運行状況の表示区分）', () => {
  it('ルートの状態と配達完了の有無から区分を決める', () => {
    expect(computeRouteOperationStatus('PENDING', false)).toBe('BEFORE_START');
    expect(computeRouteOperationStatus('IN_PROGRESS', false)).toBe('STARTED');
    expect(computeRouteOperationStatus('IN_PROGRESS', true)).toBe('IN_OPERATION');
    expect(computeRouteOperationStatus('COMPLETED', true)).toBe('COMPLETED');
  });
});

describe('dayStatusKind（荷物受付状況の区分）', () => {
  const base: DayCapacity = {
    date: '2026-10-14',
    volumeM3: 0,
    unassignedCount: 0,
    truckCount: 2,
    uncappedTruckCount: 0,
    totalM3: 10,
    effectiveM3: 10,
    overCapacity: false,
    overTime: false,
  };

  it('トラック未登録・容積未設定を区別する', () => {
    expect(dayStatusKind({ ...base, truckCount: 0 })).toBe('no-truck');
    expect(dayStatusKind({ ...base, effectiveM3: 0 })).toBe('no-capacity');
  });

  it('使用率80%以上で注意、超過フラグで超過', () => {
    expect(dayStatusKind({ ...base, volumeM3: 7.9 })).toBe('ok');
    expect(dayStatusKind({ ...base, volumeM3: 8 })).toBe('warning');
    expect(dayStatusKind({ ...base, volumeM3: 12, overCapacity: true })).toBe('over');
  });
});

describe('canEditRoute / getEditWarning（配送計画の編集可能期間）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T10:00:00+09:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 配送日はDBに「UTCの0時」で保存されている
  const route = (date: string) => ({ status: 'PENDING' as const, routeDate: new Date(`${date}T00:00:00.000Z`) });

  it('当日は編集できるが、当日である旨の注意を出す', () => {
    expect(getEditWarning(route('2026-10-14'), 10)).toBe('same_day');
  });

  it('先行登録可能日数の範囲内は編集できる', () => {
    expect(canEditRoute(route('2026-10-24'), 10)).toBe(true);
    expect(getEditWarning(route('2026-10-24'), 10)).toBe('none');
  });

  it('範囲外の未来・過去の日は編集できない', () => {
    expect(getEditWarning(route('2026-10-25'), 10)).toBe('locked');
    expect(getEditWarning(route('2026-10-13'), 10)).toBe('locked');
  });

  it('完了済みのルートも、期間内なら編集できる（稼働中の配送先追加のため）', () => {
    expect(canEditRoute({ status: 'COMPLETED', routeDate: new Date('2026-10-14T00:00:00.000Z') }, 10)).toBe(true);
  });
});

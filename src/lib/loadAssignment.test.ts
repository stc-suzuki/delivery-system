import { describe, expect, it } from 'vitest';
import { AssignTruckInput, PoolStopInput, assignStopsToTrucks } from './loadAssignment';
import { Coord } from './routeOptimizer';

const depot: Coord = { lat: 36.5657, lng: 139.8836 };
const KM_PER_DEGREE = (6371 * Math.PI) / 180;

// 本社から見て指定の方位角・距離にある配送先。荷物は「体積vol(m3)の立方体」1個
function stopAt(id: string, bearing: number, vol: number, km = 10): PoolStopInput {
  const rad = (bearing * Math.PI) / 180;
  const side = Math.cbrt(vol);
  return {
    id,
    name: id,
    lat: depot.lat + (km * Math.cos(rad)) / KM_PER_DEGREE,
    lng: depot.lng + (km * Math.sin(rad)) / (KM_PER_DEGREE * Math.cos((depot.lat * Math.PI) / 180)),
    arrivalTime: null,
    packages: [{ width: side, depth: side, height: side }],
  };
}

function truck(id: string, capacityM3: number | null, opts: Partial<AssignTruckInput> = {}): AssignTruckInput {
  return {
    truckId: id,
    driverId: `driver-${id}`,
    label: id,
    capacityM3,
    bed: null,
    trips: [{ tripId: `${id}-trip0`, tripIndex: 0, usedVolume: 0 }],
    ...opts,
  };
}

const departure = new Date('2026-10-14T09:00:00+09:00');

function stopIdsOf(result: ReturnType<typeof assignStopsToTrucks>, truckId: string): string[] {
  return result.assignments.find(a => a.truckId === truckId)!.trips.flatMap(t => t.stopIds);
}

describe('assignStopsToTrucks（AI提案の割当）', () => {
  it('どのトラックの荷台にも入らない配送先は「サイズ超過」で積み残す', () => {
    const bigCrate: PoolStopInput = { ...stopAt('crate', 0, 1), packages: [{ width: 2.5, depth: 2.5, height: 1 }] };
    const result = assignStopsToTrucks(
      [truck('t1', 100, { bed: { width: 1.6, depth: 3, height: 1.8 } })],
      [bigCrate],
      departure,
      'SWEEP_BALANCED',
      depot
    );
    expect(result.unassignedStops).toEqual([{ stopId: 'crate', reason: 'SIZE_OVER' }]);
  });

  it('荷台には入るが容積の空きがなければ「容積不足」で積み残す', () => {
    const result = assignStopsToTrucks([truck('t1', 1)], [stopAt('s1', 0, 2)], departure, 'SWEEP_BALANCED', depot);
    expect(result.unassignedStops).toEqual([{ stopId: 's1', reason: 'CAPACITY_OVER' }]);
  });

  it('容積上限が未設定のトラックは、いくらでも積める', () => {
    const result = assignStopsToTrucks([truck('t1', null)], [stopAt('s1', 0, 50)], departure, 'SWEEP_BALANCED', depot);
    expect(result.unassignedStops).toEqual([]);
    expect(stopIdsOf(result, 't1')).toEqual(['s1']);
  });

  it.each(['SWEEP', 'SWEEP_BALANCED'] as const)('同じ方面の配送先は同じトラックにまとめる（%s）', strategy => {
    const northEast = ['ne1', 'ne2', 'ne3', 'ne4'].map((id, i) => stopAt(id, 40 + i * 5, 1));
    const southWest = ['sw1', 'sw2', 'sw3', 'sw4'].map((id, i) => stopAt(id, 220 + i * 5, 1));
    const result = assignStopsToTrucks([truck('t1', 10), truck('t2', 10)], [...southWest, ...northEast], departure, strategy, depot);

    const groups = [stopIdsOf(result, 't1').sort(), stopIdsOf(result, 't2').sort()];
    expect(groups).toContainEqual(['ne1', 'ne2', 'ne3', 'ne4']);
    expect(groups).toContainEqual(['sw1', 'sw2', 'sw3', 'sw4']);
  });

  it('容量に余裕があっても、1台目に偏らず全トラックに振り分ける', () => {
    // 以前は1台目の容量に全件が収まるため、他のトラックが0件のままになっていた
    const stops = [10, 20, 30, 40, 50, 60].map((bearing, i) => stopAt(`s${i + 1}`, bearing, 1));
    const result = assignStopsToTrucks([truck('t1', 100), truck('t2', 100), truck('t3', 100)], stops, departure, 'SWEEP_BALANCED', depot);
    expect(['t1', 't2', 't3'].map(id => stopIdsOf(result, id).length)).toEqual([2, 2, 2]);
  });

  it('1件で目安量を超える大きな荷物は、既に積み始めたトラックではなく空いているトラックへ回す', () => {
    const result = assignStopsToTrucks(
      [truck('t1', 10), truck('t2', 10)],
      [stopAt('small1', 10, 1), stopAt('big', 20, 6), stopAt('small2', 30, 1)],
      departure,
      'SWEEP_BALANCED',
      depot
    );
    expect(stopIdsOf(result, 't1').sort()).toEqual(['small1', 'small2']);
    expect(stopIdsOf(result, 't2')).toEqual(['big']);
  });

  it('既に割当済みの荷物の体積を考慮して、空きのある便へ回す', () => {
    const t1 = truck('t1', 5, {
      trips: [
        { tripId: 'trip0', tripIndex: 0, usedVolume: 4 },
        { tripId: 'trip1', tripIndex: 1, usedVolume: 0 },
      ],
    });
    const result = assignStopsToTrucks([t1], [stopAt('s1', 0, 2)], departure, 'SWEEP_BALANCED', depot);
    const trips = result.assignments[0].trips;
    expect(trips.find(t => t.tripId === 'trip0')!.stopIds).toEqual([]);
    expect(trips.find(t => t.tripId === 'trip1')!.stopIds).toEqual(['s1']);
  });

  it('便を勝手に増やさず、既存の便に入らない分は積み残す', () => {
    const result = assignStopsToTrucks([truck('t1', 3)], [stopAt('s1', 10, 2), stopAt('s2', 20, 2)], departure, 'SWEEP_BALANCED', depot);
    expect(result.assignments[0].trips).toHaveLength(1);
    expect(stopIdsOf(result, 't1')).toEqual(['s1']);
    expect(result.unassignedStops).toEqual([{ stopId: 's2', reason: 'CAPACITY_OVER' }]);
  });

  it('到着希望時刻の判定は、トラックごとの出発時刻（稼働トラックの登録画面の値）で行う', () => {
    // システム設定の出発時刻は8:00だが、t1だけその日の出発を10:00にしている。
    // 9:00着希望の配送先（本社の真北15km＝30分）は、10:00出発のt1では間に合わないため8:00出発のt2へ回す
    const settingDeparture = new Date('2026-10-14T08:00:00+09:00');
    const timed: PoolStopInput = { ...stopAt('s1', 0, 1, 15), arrivalTime: '2026-10-14T09:00:00+09:00' };
    const result = assignStopsToTrucks(
      [truck('t1', 10, { departureTime: new Date('2026-10-14T10:00:00+09:00') }), truck('t2', 10)],
      [timed],
      settingDeparture,
      'SWEEP_BALANCED',
      depot
    );
    expect(stopIdsOf(result, 't1')).toEqual([]);
    expect(stopIdsOf(result, 't2')).toEqual(['s1']);
  });
});

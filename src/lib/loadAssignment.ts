// 停車地単位のFFD（First Fit Decreasing）による自動割当。
// 検証プロジェクト（../binPacking.ts）は荷物1個単位で割り当てるが、
// 実システムでは1停車地の荷物は同じトラックにまとめて積む必要があるため、
// 停車地（＝その停車地の荷物の合計）を単位として同じアルゴリズムを適用する。

import { fitsBed, Dimensions } from './loadCapacity';
import { orderWithTimeBudget, estimateStopTimes, TOCHIGI_DEPOT, bearingDeg, Coord } from './routeOptimizer';

// SWEEP: 本社から見た方位角順に処理し、容量が許す限り同じトラックへ積み続ける（方面重視）。
// SWEEP_BALANCED: 処理順はSWEEPと同じだが、今のトラックに積めなくなった際の切り替え先を
//   積載率が最も低いトラックにする（方面はある程度保ちつつ、偏りも抑える。デフォルト推奨）
export type AssignmentStrategy = 'SWEEP' | 'SWEEP_BALANCED';

export interface PoolStopInput {
  id: string;
  name: string;
  packages: Dimensions[];
  lat: number;
  lng: number;
  // 到着希望時刻（isTimeFixedがtrueの停車地のみ）。指定がなければnull
  arrivalTime: string | null;
}

export interface AssignTruckTripInput {
  tripId: string;
  tripIndex: number;
  /** 既にこの便へ割り当て済み（保存済み）の停車地の体積合計 */
  usedVolume: number;
}

export interface AssignTruckInput {
  truckId: string;
  driverId: string;
  label: string;
  capacityM3: number | null;
  bed: Dimensions | null;
  /** この日のこのトラックが既に持っている便（tripIndex昇順、1件以上）。この関数は
   *  既存の便の範囲内でしか振り分けない（＝新しい便を勝手に作ることはしない）。
   *  既存の便で収まりきらない分は「＋便を追加」で明示的に便を増やしてから、
   *  もう一度この関数を呼び出す運用にする */
  trips: AssignTruckTripInput[];
}

export type StopUnassignedReason = 'SIZE_OVER' | 'CAPACITY_OVER';

export interface StopAssignment {
  truckId: string;
  driverId: string;
  /** 便ごとの割当（既存の便の範囲内）。停車地0件の便はstopIds: []で返る */
  trips: { tripId: string; tripIndex: number; stopIds: string[]; usedVolume: number }[];
}

export interface UnassignedStop {
  stopId: string;
  reason: StopUnassignedReason;
}

export interface StopPackingResult {
  assignments: StopAssignment[];
  unassignedStops: UnassignedStop[];
}

function stopVolume(stop: PoolStopInput): number {
  return stop.packages.reduce((sum, p) => sum + p.width * p.depth * p.height, 0);
}

// 停車地の荷物が「全部」入って初めてそのトラックの荷台に収まるとみなす
// （1個単位のfitsBedとは判定粒度が異なる。停車地は分割してトラックをまたげないため）
function stopFitsBed(stop: PoolStopInput, bed: Dimensions): boolean {
  return stop.packages.every(p => fitsBed(p, bed));
}

// あるトラックに割り当てた停車地の集合が、到着希望時刻に移動時間の都合で間に合わないものを含むか判定する。
// 到着希望時刻を持つ停車地が一つもなければ判定するまでもなく常にfalse
function hasTimeConflict(assignedStops: PoolStopInput[], departureTime: Date, depot: Coord): boolean {
  if (!assignedStops.some(s => s.arrivalTime)) return false;
  const ordered = orderWithTimeBudget(depot, departureTime, assignedStops);
  const timed = estimateStopTimes(depot, departureTime, ordered);
  return timed.some(s => s.timeConflict);
}

// トラックの現在の積載率（0〜1）。容量未設定のトラックは制約なしとみなし常に「空いている」扱いにする
function fillRatio(truck: AssignTruckInput, usedVolume: number): number {
  if (truck.capacityM3 == null) return 0;
  return usedVolume / truck.capacityM3;
}

// 割当の最小単位（トラック1台の中の1便）。複数便対応：容量・積載率は便ごとに独立して管理し、
// 便をまたいだ合算はしない（＝1台のトラックでも便が複数あれば複数の独立した枠として扱う）
interface Slot {
  truckIndex: number;
  tripId: string;
  tripIndex: number;
  usedVolume: number;
  stopIds: string[];
}

// 停車地を本社から見た方位角順（スイープ法）に処理し、容量・サイズが収まる限り同じ便（トラック×便）へ
// 積み続けることで、方面ごとにまとまった割当案を作る。切り替える必要が生じたときの選び方だけが
// strategyで変わる（SWEEP: 配列順で次の便／SWEEP_BALANCED: 積載率が最も低い便）。
//
// 複数便対応：割当先の単位を「トラック」から「トラック×便」に変更した。ただしこの関数が
// 新しい便を勝手に作ることはなく、引数で渡された既存の便（trucks[].trips）の範囲内でしか
// 振り分けない。既存の便で収まりきらない分はCAPACITY_OVER（積み残し）として返すので、
// 便を増やしたい場合はユーザーが「＋便を追加」で明示的に追加してから、もう一度呼び出す
//
// 「今の便に物理的に入る限り積み続ける」だけだと、1つの便の容量にその日の荷物全体が
// 収まってしまうほど余裕がある場合、他の便が1件も使われないまま偏ってしまう
// （容量オーバーにならない限り切り替える理由が発生しないため）。これを防ぐため、
// 「その日の総荷物量 ÷ 便の総数」を各便の目安量（fair share）とし、今の便が
// 目安量に達したら、まだ物理的に積めても目安量未満の他の便へ積極的に切り替える
// （目安量未満の便が他に無ければ、積み残しを増やさないよう目安量を超えても構わず積む）。
// あくまで参考データの生成用であり、実際の到着可否は割当確定後にreorderRouteが厳密に再計算する
export function assignStopsToTrucks(
  trucks: AssignTruckInput[],
  stops: PoolStopInput[],
  departureTime: Date = new Date(),
  strategy: AssignmentStrategy = 'SWEEP_BALANCED',
  depot: Coord = TOCHIGI_DEPOT
): StopPackingResult {
  const slots: Slot[] = [];
  trucks.forEach((truck, truckIndex) => {
    truck.trips.forEach(trip => {
      slots.push({ truckIndex, tripId: trip.tripId, tripIndex: trip.tripIndex, usedVolume: trip.usedVolume, stopIds: [] });
    });
  });
  const assignedStopsBySlot: PoolStopInput[][] = slots.map(() => []);

  const sortedStops = [...stops].sort((a, b) => bearingDeg(depot, a) - bearingDeg(depot, b));
  const unassignedStops: UnassignedStop[] = [];
  let currentSlotIndex = 0;

  const totalVolume = stops.reduce((sum, s) => sum + stopVolume(s), 0);
  const fairShareM3 = slots.length > 0 ? totalVolume / slots.length : 0;

  for (const stop of sortedStops) {
    const vol = stopVolume(stop);

    const candidates = slots
      .map((slot, si) => ({ slot, si }))
      .filter(({ slot }) => {
        const truck = trucks[slot.truckIndex];
        const bedOk = truck.bed ? stopFitsBed(stop, truck.bed) : true;
        const capOk = truck.capacityM3 == null ? true : slot.usedVolume + vol <= truck.capacityM3;
        return bedOk && capOk;
      });

    if (candidates.length === 0) {
      const fitsAnyBySize = trucks.some(truck => (truck.bed ? stopFitsBed(stop, truck.bed) : true));
      unassignedStops.push({ stopId: stop.id, reason: fitsAnyBySize ? 'CAPACITY_OVER' : 'SIZE_OVER' });
      continue;
    }

    const nonConflicting = candidates.filter(
      ({ si }) => !hasTimeConflict([...assignedStopsBySlot[si], stop], departureTime, depot)
    );
    const pool = nonConflicting.length > 0 ? nonConflicting : candidates;

    // 目安量（fair share）に達していない候補だけを対象に、まず「今積んでいる便」が
    // 目安量未満ならそのまま継続する（方面をまとめる本体のロジック）。目安量に達したら、
    // 目安量未満の他の便へ積極的に切り替える
    const belowFairShare = pool.filter(({ slot }) => slot.usedVolume < fairShareM3);

    let chosen: { slot: Slot; si: number };
    if (belowFairShare.length > 0) {
      const sticky = belowFairShare.find(({ si }) => si === currentSlotIndex);
      // stickyな便が「空」（まだ何も積んでいない）場合を除き、この荷物を積んだ結果
      // 目安量を超えてしまうなら継続しない。1件だけで目安量を超える大きな荷物が、
      // たまたま目安量にまだ余裕のある（＝空ではない）現在の便に乗ってしまい、
      // 空いている他の便を差し置いて大きく超過するのを防ぐ
      const stickyOk = sticky && (sticky.slot.usedVolume === 0 || sticky.slot.usedVolume + vol <= fairShareM3);
      if (stickyOk) {
        chosen = sticky!;
      } else if (strategy === 'SWEEP_BALANCED') {
        chosen = belowFairShare.reduce((best, cur) =>
          fillRatio(trucks[cur.slot.truckIndex], cur.slot.usedVolume) <
          fillRatio(trucks[best.slot.truckIndex], best.slot.usedVolume)
            ? cur
            : best
        );
      } else {
        chosen = belowFairShare.find(({ si }) => si > currentSlotIndex) ?? belowFairShare[0];
      }
    } else {
      // 候補全員が目安量に達している：積み残しを避けるため目安量を無視して積むしかないが、
      // ここで「今の便へ戻る」と偏りが再発するため、戦略によらず積載率が最も低い便を選ぶ
      // （この局面では方面のまとまりより偏り防止を優先する）
      chosen = pool.reduce((best, cur) =>
        fillRatio(trucks[cur.slot.truckIndex], cur.slot.usedVolume) <
        fillRatio(trucks[best.slot.truckIndex], best.slot.usedVolume)
          ? cur
          : best
      );
    }

    chosen.slot.stopIds.push(stop.id);
    chosen.slot.usedVolume += vol;
    assignedStopsBySlot[chosen.si].push(stop);
    currentSlotIndex = chosen.si;
  }

  const assignments: StopAssignment[] = trucks.map((truck, truckIndex) => ({
    truckId: truck.truckId,
    driverId: truck.driverId,
    trips: slots
      .filter(s => s.truckIndex === truckIndex)
      .map(s => ({ tripId: s.tripId, tripIndex: s.tripIndex, stopIds: s.stopIds, usedVolume: s.usedVolume })),
  }));

  return { assignments, unassignedStops };
}

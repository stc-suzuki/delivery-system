// 時間超過判定（配送先が多すぎて「運送終了時間（定時）」までに配り終えられないか）の純粋関数群。
// 既存のFFD自動割当（loadAssignment.ts）とルート順序決めシミュレーション（routeOptimizer.ts）を
// 組み合わせて、「今日この時点で登録されている内容を全部配りきるとして、各トラックは定時に間に合うか」
// を1日分まとめて計算する。あくまで参考シミュレーションであり、何も永続化しない（既存のFFD自動割当と同じ位置づけ）。
// 複数便対応：1台＝1回の積み込みで1日分を配りきる前提ではなく、容積上限に達するたびに本社を
// 経由して積み直す（＝複数便に分かれる）ことを見込んでシミュレーションする（simulateFinish参照）。

import { orderWithTimeBudget, estimateStopTimes, estimateReturnToDepotTime, TOCHIGI_DEPOT, LunchBreak, STOP_DURATION_MINUTES, Coord } from './routeOptimizer';
import { AssignTruckInput, PoolStopInput } from './loadAssignment';
import { fitsBed } from './loadCapacity';

// AssignTruckInputの便情報（trips）はloadAssignment.ts側（既存の便の範囲内でしか振り分けない）
// のための情報で、この時間シミュレーション（動的に何便でも見込む）には不要なため除外する
export interface TruckDayInput extends Omit<AssignTruckInput, 'trips'> {
  /** その日・そのトラックの出発時刻（route.departureTimeまたはデフォルト出発時間から解決済みのもの） */
  departureTime: Date;
  /** 既に手動割当済み・完了していない停車地（このトラックのルートに実際に紐づいているもの） */
  assignedStops: PoolStopInput[];
}

export interface TruckTimeResult {
  truckId: string;
  /** 最後の停車地の荷下ろし完了後、本社へ戻り終える予定時刻。停車地が1件もなければnull */
  finishTime: Date | null;
  /** 定時（deliveryEndTime）を過ぎているか */
  overDeadline: boolean;
}

export interface TimeOverflowResult {
  /** 1台でも定時を過ぎていればtrue */
  overCapacityTime: boolean;
  truckResults: TruckTimeResult[];
}

function stopVolume(stop: PoolStopInput): number {
  return stop.packages.reduce((sum, p) => sum + p.width * p.depth * p.height, 0);
}

function stopFitsBed(stop: PoolStopInput, bed: NonNullable<AssignTruckInput['bed']>): boolean {
  return stop.packages.every(p => fitsBed(p, bed));
}

interface FinishSimulation {
  finishTime: Date;
  hasArrivalConflict: boolean;
}

// 停車地の並びを到着希望時刻込みで（1日分まとめて1回だけ）組み直したうえで、その並び順のまま
// 積算体積が容積上限を超えるたびに本社を経由して便を切り替える（＝複数便対応）。区切りごとに
// 「荷下ろし完了→本社帰着→積み込み（reloadDurationMinutes）」を挟み、最後の便の本社帰着見込み
// 時刻を返す。容積は「1日の上限」ではなく「1便あたりの上限（＝リロードが必要になる閾値）」として
// 扱う点が単一便時代との違い。並び順自体は1日分をまとめて決めるため、大きい荷物を後回しにして
// 便の区切りを遅らせる、といった賢い最適化はしない（既存のFFDと同じく厳密な最適解の保証はない）
function simulateFinish(
  departureTime: Date,
  stops: PoolStopInput[],
  lunchBreak: LunchBreak | undefined,
  stopDurationMinutes: number,
  depot: Coord,
  capacityM3: number | null,
  reloadDurationMinutes: number
): FinishSimulation {
  const ordered = orderWithTimeBudget(depot, departureTime, stops, lunchBreak);

  let hasArrivalConflict = false;
  let tripStartTime = departureTime;
  let tripVolume = 0;
  let batch: PoolStopInput[] = [];
  let finishTime = departureTime;

  const closeTrip = () => {
    if (batch.length === 0) return;
    const timed = estimateStopTimes(depot, tripStartTime, batch, lunchBreak, stopDurationMinutes);
    hasArrivalConflict = hasArrivalConflict || timed.some(s => s.timeConflict);
    const last = timed[timed.length - 1];
    finishTime = estimateReturnToDepotTime(depot, last, last.estimatedTime, lunchBreak, stopDurationMinutes);
    batch = [];
    tripVolume = 0;
  };

  for (const stop of ordered) {
    const vol = stopVolume(stop);
    // 既に1件以上積んでいる便に、この荷物を積むと容積上限を超える場合は、そこで便を区切る
    // （batch.length > 0を条件にすることで、1件だけで上限を超える荷物も必ず1便には積む）
    if (capacityM3 != null && batch.length > 0 && tripVolume + vol > capacityM3) {
      closeTrip();
      tripStartTime = new Date(finishTime.getTime() + reloadDurationMinutes * 60 * 1000);
    }
    batch.push(stop);
    tripVolume += vol;
  }
  closeTrip();

  return { finishTime, hasArrivalConflict };
}

export function checkTimeOverflow(
  trucks: TruckDayInput[],
  poolStops: PoolStopInput[],
  deliveryEndTime: Date,
  loadUtilizationPercent: number,
  reloadDurationMinutes: number,
  lunchBreak?: LunchBreak,
  stopDurationMinutes: number = STOP_DURATION_MINUTES,
  depot: Coord = TOCHIGI_DEPOT
): TimeOverflowResult {
  if (trucks.length === 0) {
    return { overCapacityTime: false, truckResults: [] };
  }

  // 未割当（プール）分をどのトラックに積むかは、体積の大きい順（FFD）に、
  // 「荷台サイズに収まり」「到着希望時刻に矛盾せず」「その荷物を積んでも最も早く終わる」トラックへ
  // 仮に振り分けて決める。loadAssignment.tsのassignStopsToTrucksと異なり、この関数は各トラックの
  // 実際の出発時刻・定時を使い、特定の1台に配送先が偏らないよう手が空いているトラックを優先する
  // （貪欲法のため、必ず最適な組み合わせを見つけられる保証はない）。
  // 複数便対応後は容積で「積めない」トラックが無くなった（本社に戻って積み直せば何便でも積める）
  // ため、容積による候補フィルタは行わない。容積の影響は、simulateFinish内でリロード回数が
  // 増える＝所要時間が延びるという形でfinishTimeに反映され、それが「最も早く終わるトラック」の
  // 選定に自然と織り込まれる
  const effectiveCapacity = new Map<string, number | null>(
    trucks.map(t => [t.truckId, t.capacityM3 == null ? null : t.capacityM3 * (loadUtilizationPercent / 100)])
  );
  const stopsByTruck = new Map<string, PoolStopInput[]>(trucks.map(t => [t.truckId, [...t.assignedStops]]));

  const sortedStops = [...poolStops].sort((a, b) => stopVolume(b) - stopVolume(a));

  for (const stop of sortedStops) {
    const candidates = trucks.filter(t => (t.bed ? stopFitsBed(stop, t.bed) : true));
    // 荷台サイズ的にどのトラックにも積めない場合、このシミュレーションでは無視する
    // （SIZE_OVERの判定・表示自体はloadAssignment.ts側のAI提案が別途担う）
    if (candidates.length === 0) continue;

    const scored = candidates.map(t => ({
      truck: t,
      sim: simulateFinish(
        t.departureTime,
        [...stopsByTruck.get(t.truckId)!, stop],
        lunchBreak,
        stopDurationMinutes,
        depot,
        effectiveCapacity.get(t.truckId) ?? null,
        reloadDurationMinutes
      ),
    }));
    // 到着希望時刻に矛盾しない候補を優先し、その中で「この荷物を積んだ場合に最も早く終わる
    // （＝最も手が空いている）トラック」を選ぶ。体積の大きい順に処理しながら常に手が空いている
    // トラックへ回すことで、特定の1台だけに配送先が偏って定時超過になるのを防ぐ
    // （厳密な最適解の保証はない貪欲法だが、偏りは大きく緩和される）
    const noConflict = scored.filter(s => !s.sim.hasArrivalConflict);
    const pool = noConflict.length > 0 ? noConflict : scored;
    const best = pool.reduce((a, b) => (b.sim.finishTime.getTime() < a.sim.finishTime.getTime() ? b : a));

    stopsByTruck.get(best.truck.truckId)!.push(stop);
  }

  const truckResults: TruckTimeResult[] = trucks.map(t => {
    const allStops = stopsByTruck.get(t.truckId)!;
    if (allStops.length === 0) {
      return { truckId: t.truckId, finishTime: null, overDeadline: false };
    }
    const sim = simulateFinish(
      t.departureTime,
      allStops,
      lunchBreak,
      stopDurationMinutes,
      depot,
      effectiveCapacity.get(t.truckId) ?? null,
      reloadDurationMinutes
    );
    return { truckId: t.truckId, finishTime: sim.finishTime, overDeadline: sim.finishTime.getTime() > deliveryEndTime.getTime() };
  });

  return { overCapacityTime: truckResults.some(r => r.overDeadline), truckResults };
}

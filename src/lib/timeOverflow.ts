// 時間超過判定（配送先が多すぎて「運送終了時間（定時）」までに配り終えられないか）の純粋関数群。
// 既存のFFD自動割当（loadAssignment.ts）とルート順序決めシミュレーション（routeOptimizer.ts）を
// 組み合わせて、「今日この時点で登録されている内容を全部配りきるとして、各トラックは定時に間に合うか」
// を1日分まとめて計算する。あくまで参考シミュレーションであり、何も永続化しない（既存のFFD自動割当と同じ位置づけ）。
// 複数便対応：1台＝1回の積み込みで1日分を配りきる前提ではなく、容積上限に達するたびに本社を
// 経由して積み直す（＝複数便に分かれる）ことを見込んでシミュレーションする（simulateFinish参照）。

import { orderWithTimeBudget, estimateStopTimes, estimateReturnToDepotTime, addTimeOutsideLunch, skipLunchBreak, travelTimeMs, TOCHIGI_DEPOT, LunchBreak, STOP_DURATION_MINUTES, Coord, TravelModel, DEFAULT_TRAVEL_MODEL } from './routeOptimizer';
import { AssignTruckInput, PoolStopInput } from './loadAssignment';
import { fitsBed } from './loadCapacity';

// AssignTruckInputの便情報（trips）はloadAssignment.ts側（既存の便の範囲内でしか振り分けない）
// のための情報で、この時間シミュレーション（動的に何便でも見込む）には不要なため除外する
export interface TruckDayInput extends Omit<AssignTruckInput, 'trips'> {
  /** その日・そのトラックの出発時刻（route.departureTimeまたはデフォルト出発時間から解決済みのもの）。
   * 当日の出発済みトラックは「今」の時刻（dayTimeOverflow.ts参照） */
  departureTime: Date;
  /** 既に手動割当済み・完了していない停車地（このトラックのルートに実際に紐づいているもの） */
  assignedStops: PoolStopInput[];
  /** 計算を始める場所。省略時は本社。当日の出発済みトラックは今いる場所 */
  startPos?: Coord;
  /** 未割当の配送先をこのトラックに積む場合、先に本社へ戻って積み込む（出発済みのトラック）。
   * 今積んでいる配送先（assignedStops）だけなら本社に戻らず、そのまま配る */
  reloadBeforePool?: boolean;
}

export interface TruckTimeResult {
  truckId: string;
  /** 最後の停車地の荷下ろし完了後、本社へ戻り終える予定時刻。停車地が1件もなければnull */
  finishTime: Date | null;
  /** 定時（deliveryEndTime）を過ぎているか */
  overDeadline: boolean;
  /** 時間指定・時間帯（目安）に間に合わない停車地のID */
  arrivalConflictStopIds: string[];
  /** このトラックに（割当済み＋仮の振り分けで）積む停車地 */
  stops: PoolStopInput[];
}

export interface TimeOverflowResult {
  /** 1台でも定時を過ぎていればtrue */
  overCapacityTime: boolean;
  truckResults: TruckTimeResult[];
  /** 全トラック分の、時間指定・時間帯に間に合わない停車地のID（時間指定が重なってトラックが足りない場合など） */
  arrivalConflictStopIds: string[];
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
  arrivalConflictStopIds: string[];
  /** 停車地ごとの到着予定時刻 */
  estimatedTimes: Map<string, Date>;
}

// 停車地の並びを到着希望時刻込みで（1日分まとめて1回だけ）組み直したうえで、その並び順のまま
// 積算体積が容積上限を超えるたびに本社を経由して便を切り替える（＝複数便対応）。区切りごとに
// 「荷下ろし完了→本社帰着→積み込み（reloadDurationMinutes）」を挟み、最後の便の本社帰着見込み
// 時刻を返す。容積は「1日の上限」ではなく「1便あたりの上限（＝リロードが必要になる閾値）」として
// 扱う点が単一便時代との違い。並び順自体は1日分をまとめて決めるため、大きい荷物を後回しにして
// 便の区切りを遅らせる、といった賢い最適化はしない（既存のFFDと同じく厳密な最適解の保証はない）
// 当日の出発済みトラックは、今いる場所（startPos）・今の時刻（departureTime）から始める。
// reloadFirstのときは、稼働中ルートへの配送先追加（optimize/route.ts）と同じく、先に本社へ戻って
// 積み込んでから、今積んでいる分と追加分をまとめて配る
function simulateFinish(
  departureTime: Date,
  stops: PoolStopInput[],
  lunchBreak: LunchBreak | undefined,
  stopDurationMinutes: number,
  depot: Coord,
  capacityM3: number | null,
  reloadDurationMinutes: number,
  travel: TravelModel,
  startPos: Coord = depot,
  reloadFirst = false
): FinishSimulation {
  let tripStartPos = startPos;
  let tripStartTime = departureTime;
  if (reloadFirst) {
    const arrivalAtDepot = skipLunchBreak(addTimeOutsideLunch(departureTime, travelTimeMs(startPos, depot, travel), lunchBreak), lunchBreak);
    tripStartTime = addTimeOutsideLunch(arrivalAtDepot, reloadDurationMinutes * 60 * 1000, lunchBreak);
    tripStartPos = depot;
  }
  const ordered = orderWithTimeBudget(tripStartPos, tripStartTime, stops, lunchBreak, travel);

  const arrivalConflictStopIds: string[] = [];
  const estimatedTimes = new Map<string, Date>();
  let tripVolume = 0;
  let batch: PoolStopInput[] = [];
  let finishTime = tripStartTime;

  const closeTrip = () => {
    if (batch.length === 0) return;
    const timed = estimateStopTimes(tripStartPos, tripStartTime, batch, lunchBreak, stopDurationMinutes, travel);
    // 2便目以降は本社から出る
    tripStartPos = depot;
    arrivalConflictStopIds.push(...timed.filter(s => s.timeConflict).map(s => s.id));
    for (const s of timed) estimatedTimes.set(s.id, s.estimatedTime);
    const last = timed[timed.length - 1];
    finishTime = estimateReturnToDepotTime(depot, last, last.estimatedTime, lunchBreak, stopDurationMinutes, travel);
    batch = [];
    tripVolume = 0;
  };

  for (const stop of ordered) {
    const vol = stopVolume(stop);
    // 既に1件以上積んでいる便に、この荷物を積むと容積上限を超える場合は、そこで便を区切る
    // （batch.length > 0を条件にすることで、1件だけで上限を超える荷物も必ず1便には積む）
    if (capacityM3 != null && batch.length > 0 && tripVolume + vol > capacityM3) {
      closeTrip();
      // 昼休み中は積み込みも止めて休むため、途中で昼休みに入れば休憩明けに残りを済ませる
      tripStartTime = addTimeOutsideLunch(finishTime, reloadDurationMinutes * 60 * 1000, lunchBreak);
    }
    batch.push(stop);
    tripVolume += vol;
  }
  closeTrip();

  return { finishTime, hasArrivalConflict: arrivalConflictStopIds.length > 0, arrivalConflictStopIds, estimatedTimes };
}

// checkTimeOverflow・evaluateInsertionで共通の、1台分のシミュレーション
function truckSimulator(
  loadUtilizationPercent: number,
  reloadDurationMinutes: number,
  lunchBreak: LunchBreak | undefined,
  stopDurationMinutes: number,
  depot: Coord,
  travel: TravelModel
) {
  // stopsは割当済み（assignedStops）の後ろに未割当分を足したもの。未割当分が含まれていれば、
  // 出発済みのトラックは本社へ戻って積み込んでから配る
  return (t: TruckDayInput, stops: PoolStopInput[]) =>
    simulateFinish(
      t.departureTime,
      stops,
      lunchBreak,
      stopDurationMinutes,
      depot,
      t.capacityM3 == null ? null : t.capacityM3 * (loadUtilizationPercent / 100),
      reloadDurationMinutes,
      travel,
      t.startPos ?? depot,
      !!t.reloadBeforePool && stops.length > t.assignedStops.length
    );
}

export type InsertionFailure = 'size' | 'arrival' | 'breaks-others' | 'deadline';

export interface InsertionResult {
  /** どれかのトラックに、誰の時間の条件も崩さず・定時までに積めるか */
  ok: boolean;
  /** 積めるトラックのうち最も早く終わるもの（okのとき） */
  truckId: string | null;
  /** そのトラックの本社帰着予定（okのとき） */
  finishTime: Date | null;
  /** 足す配送先の到着予定（okのとき）。okでなければ、全トラックの中で最も早い到着予定 */
  candidateArrival: Date | null;
  /** 積めない理由（okでないとき）。最も惜しいトラックの理由 */
  failure: InsertionFailure | null;
  /** failureが'breaks-others'のとき、条件から外れてしまう先に受けた配送先のID */
  brokenStopIds: string[];
  /** failureが'deadline'のとき、そのトラックの本社帰着予定 */
  failureFinishTime: Date | null;
}

// 荷物受付の「空いている日時」の判定（2026-11-16導入）。checkTimeOverflowで仮に振り分けた今の状態
// （baseline）に、新しい配送先を1件だけ足せるかをトラックごとに試す。全体を振り分け直すより大幅に
// 軽いので、日付×時間帯の表をまとめて計算できる。先に受けた配送先を優先する（2026-11-16決定）ため、
// 足したことで、今は間に合っている配送先の時間指定・時間帯が崩れるトラックには積まない
export function evaluateInsertion(
  trucks: TruckDayInput[],
  baseline: TimeOverflowResult,
  candidate: PoolStopInput,
  deliveryEndTime: Date,
  loadUtilizationPercent: number,
  reloadDurationMinutes: number,
  lunchBreak?: LunchBreak,
  stopDurationMinutes: number = STOP_DURATION_MINUTES,
  depot: Coord = TOCHIGI_DEPOT,
  travel: TravelModel = DEFAULT_TRAVEL_MODEL
): InsertionResult {
  const simulateTruck = truckSimulator(loadUtilizationPercent, reloadDurationMinutes, lunchBreak, stopDurationMinutes, depot, travel);
  const baseByTruck = new Map(baseline.truckResults.map(r => [r.truckId, r]));

  type Attempt = { truckId: string; failures: InsertionFailure[]; finish: Date; arrival: Date | null; broken: string[] };
  const attempts: Attempt[] = [];
  let sizeOnly = true;
  for (const t of trucks) {
    if (t.bed && !stopFitsBed(candidate, t.bed)) continue;
    sizeOnly = false;
    const base = baseByTruck.get(t.truckId);
    const baseStops = base?.stops ?? t.assignedStops;
    const baseConflicts = new Set(base?.arrivalConflictStopIds ?? []);
    const sim = simulateTruck(t, [...baseStops, candidate]);
    const failures: InsertionFailure[] = [];
    if (sim.arrivalConflictStopIds.includes(candidate.id)) failures.push('arrival');
    const broken = sim.arrivalConflictStopIds.filter(id => id !== candidate.id && !baseConflicts.has(id));
    if (broken.length > 0) failures.push('breaks-others');
    if (sim.finishTime.getTime() > deliveryEndTime.getTime()) failures.push('deadline');
    attempts.push({ truckId: t.truckId, failures, finish: sim.finishTime, arrival: sim.estimatedTimes.get(candidate.id) ?? null, broken });
  }

  const empty = { brokenStopIds: [], failureFinishTime: null };
  if (sizeOnly) return { ok: false, truckId: null, finishTime: null, candidateArrival: null, failure: 'size', ...empty };

  const oks = attempts.filter(a => a.failures.length === 0);
  if (oks.length > 0) {
    const best = oks.reduce((a, b) => (b.finish.getTime() < a.finish.getTime() ? b : a));
    return { ok: true, truckId: best.truckId, finishTime: best.finish, candidateArrival: best.arrival, failure: null, ...empty };
  }

  // 最も惜しいトラック（理由が少ない、同じなら早く終わる）の理由を返す。理由が複数あれば、
  // 自分が着けない＞他を崩す＞定時を過ぎる、の順に伝える
  const closest = attempts.reduce((a, b) =>
    b.failures.length < a.failures.length || (b.failures.length === a.failures.length && b.finish.getTime() < a.finish.getTime()) ? b : a
  );
  const order: InsertionFailure[] = ['arrival', 'breaks-others', 'deadline'];
  const failure = order.find(f => closest.failures.includes(f))!;
  const arrivals = attempts.map(a => a.arrival).filter((d): d is Date => d != null);
  return {
    ok: false,
    truckId: null,
    finishTime: null,
    candidateArrival: arrivals.length > 0 ? new Date(Math.min(...arrivals.map(d => d.getTime()))) : null,
    failure,
    brokenStopIds: failure === 'breaks-others' ? closest.broken : [],
    failureFinishTime: failure === 'deadline' ? closest.finish : null,
  };
}

export function checkTimeOverflow(
  trucks: TruckDayInput[],
  poolStops: PoolStopInput[],
  deliveryEndTime: Date,
  loadUtilizationPercent: number,
  reloadDurationMinutes: number,
  lunchBreak?: LunchBreak,
  stopDurationMinutes: number = STOP_DURATION_MINUTES,
  depot: Coord = TOCHIGI_DEPOT,
  travel: TravelModel = DEFAULT_TRAVEL_MODEL
): TimeOverflowResult {
  if (trucks.length === 0) {
    return { overCapacityTime: false, truckResults: [], arrivalConflictStopIds: [] };
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
  const stopsByTruck = new Map<string, PoolStopInput[]>(trucks.map(t => [t.truckId, [...t.assignedStops]]));
  const simulateTruck = truckSimulator(loadUtilizationPercent, reloadDurationMinutes, lunchBreak, stopDurationMinutes, depot, travel);

  const sortedStops = [...poolStops].sort((a, b) => stopVolume(b) - stopVolume(a));

  for (const stop of sortedStops) {
    const candidates = trucks.filter(t => (t.bed ? stopFitsBed(stop, t.bed) : true));
    // 荷台サイズ的にどのトラックにも積めない場合、このシミュレーションでは無視する
    // （SIZE_OVERの判定・表示自体はloadAssignment.ts側のAI提案が別途担う）
    if (candidates.length === 0) continue;

    const scored = candidates.map(t => ({
      truck: t,
      sim: simulateTruck(t, [...stopsByTruck.get(t.truckId)!, stop]),
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
      return { truckId: t.truckId, finishTime: null, overDeadline: false, arrivalConflictStopIds: [], stops: [] };
    }
    const sim = simulateTruck(t, allStops);
    return {
      truckId: t.truckId,
      finishTime: sim.finishTime,
      overDeadline: sim.finishTime.getTime() > deliveryEndTime.getTime(),
      arrivalConflictStopIds: sim.arrivalConflictStopIds,
      stops: allStops,
    };
  });

  return {
    overCapacityTime: truckResults.some(r => r.overDeadline),
    truckResults,
    arrivalConflictStopIds: truckResults.flatMap(r => r.arrivalConflictStopIds),
  };
}

// 到着の時間帯（目安）。2026-11-16、先方の回答で3つに決まった（8–12／12–15／15–17）。
// 時間帯は「その中に着けばよい」目安で、時間指定（requestedArrivalTime＝その時刻ちょうど）とは別物。
// DBには時間帯の名前ではなく、その日の始まり・終わりの日時（requestedWindowStart/End）を保存する
// （後で区切りを変えても、受付済みの配送先の時間帯は受け付けた時のまま残すため）

export interface TimeBand {
  key: string;
  /** 画面に出す名前（例：8–12） */
  label: string;
  /** HH:mm（日本時間） */
  start: string;
  end: string;
}

export const TIME_BANDS: TimeBand[] = [
  { key: 'AM', label: '8–12', start: '08:00', end: '12:00' },
  { key: 'MIDDAY', label: '12–15', start: '12:00', end: '15:00' },
  { key: 'PM', label: '15–17', start: '15:00', end: '17:00' },
];

/** 配送日（YYYY-MM-DD）と時間帯から、保存する始まり・終わりの日時（日本時間） */
export function bandWindowOnDate(dateStr: string, band: TimeBand): { start: Date; end: Date } {
  return {
    start: new Date(`${dateStr}T${band.start}:00+09:00`),
    end: new Date(`${dateStr}T${band.end}:00+09:00`),
  };
}

function jstHhmm(d: Date): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** 保存済みの始まり・終わりの日時に一致する時間帯（区切りを変えた後などで一致しなければnull） */
export function bandOfWindow(start: Date | string, end: Date | string): TimeBand | null {
  const s = jstHhmm(new Date(start));
  const e = jstHhmm(new Date(end));
  return TIME_BANDS.find(b => b.start === s && b.end === e) ?? null;
}

/** 時間帯の表示名。決まった区切りに一致しなければ「8:30–11:00」のように時刻をそのまま出す */
export function windowLabel(start: Date | string, end: Date | string): string {
  const band = bandOfWindow(start, end);
  if (band) return band.label;
  const trim = (hhmm: string) => hhmm.replace(/^0/, '');
  return `${trim(jstHhmm(new Date(start)))}–${trim(jstHhmm(new Date(end)))}`;
}

/** 間に合わない見込みの配送先として画面に返す1件分。時間の条件がない停車地はnull */
export function arrivalConflictEntry(stop: {
  id: string;
  location: { name: string };
  requestedArrivalTime: Date | null;
  requestedWindowStart?: Date | null;
  requestedWindowEnd?: Date | null;
}): { stopId: string; locationName: string; requestedArrivalTime: string | null; windowLabel: string | null } | null {
  if (stop.requestedArrivalTime) {
    return { stopId: stop.id, locationName: stop.location.name, requestedArrivalTime: stop.requestedArrivalTime.toISOString(), windowLabel: null };
  }
  if (stop.requestedWindowStart && stop.requestedWindowEnd) {
    return {
      stopId: stop.id,
      locationName: stop.location.name,
      requestedArrivalTime: null,
      windowLabel: windowLabel(stop.requestedWindowStart, stop.requestedWindowEnd),
    };
  }
  return null;
}

/** 間に合わない見込みの配送先の表示（例：「〇〇店（10:00指定）」「〇〇店（8–12・目安）」） */
export function arrivalConflictText(c: { locationName: string; requestedArrivalTime: string | null; windowLabel?: string | null }): string {
  if (c.requestedArrivalTime) return `${c.locationName}（${jstHhmm(new Date(c.requestedArrivalTime))}指定）`;
  return `${c.locationName}（${c.windowLabel ?? '時間帯'}・目安）`;
}

/** DBの停車地から、ルート計算に渡す到着の条件（routeOptimizer.tsのArrivalConstraint）を作る */
export function stopArrivalConstraint(stop: {
  requestedArrivalTime: Date | null;
  requestedWindowStart?: Date | null;
  requestedWindowEnd?: Date | null;
}): { arrivalTime: string | null; windowStart: string | null; windowEnd: string | null } {
  if (stop.requestedArrivalTime) {
    return { arrivalTime: stop.requestedArrivalTime.toISOString(), windowStart: null, windowEnd: null };
  }
  if (stop.requestedWindowStart && stop.requestedWindowEnd) {
    return {
      arrivalTime: null,
      windowStart: stop.requestedWindowStart.toISOString(),
      windowEnd: stop.requestedWindowEnd.toISOString(),
    };
  }
  return { arrivalTime: null, windowStart: null, windowEnd: null };
}

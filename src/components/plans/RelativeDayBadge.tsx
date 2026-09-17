import { format, differenceInCalendarDays } from 'date-fns';

export default function RelativeDayBadge({ date }: { date: string }) {
  const dayOffset = differenceInCalendarDays(new Date(date), new Date(format(new Date(), 'yyyy-MM-dd')));
  const isPast = dayOffset < 0;
  const label =
    dayOffset === 0
      ? '今日'
      : dayOffset === 1
        ? '明日'
        : dayOffset === 2
          ? '明後日'
          : isPast
            ? `${Math.abs(dayOffset)}日前`
            : `${dayOffset}日後`;

  return (
    <span
      className={`rounded-full px-3 py-1 text-base font-bold ${
        label === '今日' ? 'bg-blue-600 text-white' : isPast ? 'bg-gray-400 text-white' : 'bg-blue-50 text-blue-600'
      }`}
    >
      {label}
    </span>
  );
}

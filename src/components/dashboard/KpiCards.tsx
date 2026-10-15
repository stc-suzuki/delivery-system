import { Route, CheckCircle2, Clock, AlertTriangle, type LucideIcon } from 'lucide-react';

type Props = {
  routeCount: number;
  completedCount: number;
  inProgressCount: number;
  unassignedTrucks: number;
  totalTrucks: number;
};

type Tint = 'blue' | 'green' | 'yellow' | 'gray';

// ドライバー稼働状況（DriverStatusTable）のバッジ配色（待機中=グレー・進行中=黄・配達完了=緑）に揃えている
const TINT_CLASSES: Record<Tint, string> = {
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-green-50 text-green-600',
  yellow: 'bg-yellow-50 text-yellow-700',
  gray: 'bg-gray-100 text-gray-600',
};

export default function KpiCards({ routeCount, completedCount, inProgressCount, unassignedTrucks, totalTrucks }: Props) {
  const cards: { label: string; value: string | number; icon: LucideIcon; tint: Tint }[] = [
    { label: '本日のルート数', value: routeCount, icon: Route, tint: 'blue' },
    { label: '未割り当てトラック', value: `${unassignedTrucks} / ${totalTrucks}`, icon: AlertTriangle, tint: 'gray' },
    { label: '進行中', value: inProgressCount, icon: Clock, tint: 'yellow' },
    { label: '配達完了', value: completedCount, icon: CheckCircle2, tint: 'green' },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(card => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="flex items-center gap-3 rounded-lg border border-panel-line bg-panel p-4 shadow-sm">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${TINT_CLASSES[card.tint]}`}>
              <Icon className="h-4 w-4" />
            </div>
            <p className="truncate text-sm text-[#4B5563]">{card.label}</p>
            <p className="ml-auto shrink-0 text-2xl font-bold text-heading">{card.value}</p>
          </div>
        );
      })}
    </div>
  );
}

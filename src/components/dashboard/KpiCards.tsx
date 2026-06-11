type Props = {
  planCount: number;
  completedCount: number;
  inProgressCount: number;
  unassignedTrucks: number;
  totalTrucks: number;
};

export default function KpiCards({ planCount, completedCount, inProgressCount, unassignedTrucks, totalTrucks }: Props) {
  const cards = [
    { label: '本日の計画数', value: planCount },
    { label: '完了', value: completedCount },
    { label: '進行中', value: inProgressCount },
    { label: '未割り当てトラック', value: `${unassignedTrucks} / ${totalTrucks}` },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(card => (
        <div key={card.label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">{card.label}</p>
          <p className="mt-2 text-2xl font-bold text-gray-800">{card.value}</p>
        </div>
      ))}
    </div>
  );
}

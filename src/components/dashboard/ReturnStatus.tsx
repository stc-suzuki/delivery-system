import { format } from 'date-fns';
import { Undo2, Warehouse } from 'lucide-react';

// 配達をすべて終えたルートの「帰社途中」「帰社済み」の表示。ドライバー稼働状況の行と、
// 本日の配送ルートのカードで同じ色・文言を使う（帰社途中＝オレンジ系、帰社済み＝緑系）
export function returnStatusOf(returnedAt: string | null, returnEta: string | null) {
  if (returnedAt) {
    return {
      returned: true,
      Icon: Warehouse,
      label: `帰社済み ${format(new Date(returnedAt), 'HH:mm')}`,
      className: 'bg-emerald-50 text-emerald-800',
    };
  }
  return {
    returned: false,
    Icon: Undo2,
    label: returnEta ? `帰社途中 ${format(new Date(returnEta), 'HH:mm')}予定` : '帰社途中',
    className: 'bg-amber-50 text-amber-800',
  };
}

export function ReturnStatusPill({ returnedAt, returnEta }: { returnedAt: string | null; returnEta: string | null }) {
  const { Icon, label, className } = returnStatusOf(returnedAt, returnEta);
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}

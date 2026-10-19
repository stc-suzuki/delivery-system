import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type Tint = 'blue' | 'blueSoft' | 'gray';

const CONTAINER_CLASSES: Record<Tint, string> = {
  blue: 'bg-blue-100 border-blue-200',
  blueSoft: 'bg-indigo-100 border-indigo-200',
  gray: 'bg-gray-200 border-gray-300',
};

// サイドバーのメニュー区分の見出し（Sidebar.tsxのrenderZoneLabel）と同じ色のタイル
const BADGE_CLASSES: Record<Tint, string> = {
  blue: 'bg-blue-600 text-white',
  blueSoft: 'bg-indigo-600 text-white',
  gray: 'bg-gray-600 text-white',
};

const TITLE_CLASSES: Record<Tint, string> = {
  blue: 'text-blue-900',
  blueSoft: 'text-indigo-900',
  gray: 'text-gray-900',
};

const DESCRIPTION_CLASSES: Record<Tint, string> = {
  blue: 'text-blue-700',
  blueSoft: 'text-indigo-700',
  gray: 'text-gray-700',
};

type Props = {
  icon: LucideIcon;
  title: ReactNode;
  // 省略した画面（ダッシュボード）は1行の見出しになる
  description?: ReactNode;
  tint: Tint;
  action?: ReactNode;
  showDeliveryAdminBadge?: boolean;
};

export default function PageHeader({ icon: Icon, title, description, tint, action, showDeliveryAdminBadge }: Props) {
  return (
    <div className={`flex flex-wrap gap-3 rounded-lg border p-4 ${description ? 'items-start' : 'items-center'} ${CONTAINER_CLASSES[tint]}`}>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm ${BADGE_CLASSES[tint]}`}>
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={`text-lg font-bold ${TITLE_CLASSES[tint]}`}>{title}</h1>
          {(tint === 'blueSoft' || showDeliveryAdminBadge) && (
            <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-semibold text-white">配送管理者</span>
          )}
        </div>
        {description && <p className={`mt-0.5 text-sm ${DESCRIPTION_CLASSES[tint]}`}>{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

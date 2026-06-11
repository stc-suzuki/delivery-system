import { PlanStatus } from '@prisma/client';

const STYLES: Record<PlanStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
  COMPLETED: 'bg-green-100 text-green-700',
};

const LABELS: Record<PlanStatus, string> = {
  DRAFT: '下書き',
  CONFIRMED: '確定',
  IN_PROGRESS: '進行中',
  COMPLETED: '完了',
};

export default function PlanStatusBadge({ status }: { status: PlanStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}

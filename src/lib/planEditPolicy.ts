import { DeliveryPlan, PlanStatus } from '@prisma/client';
import { differenceInDays, startOfDay } from 'date-fns';

export function canEditPlan(plan: DeliveryPlan): boolean {
  if (plan.status === PlanStatus.IN_PROGRESS || plan.status === PlanStatus.COMPLETED) {
    return false;
  }
  const today = startOfDay(new Date());
  const planDate = startOfDay(new Date(plan.planDate));
  const diff = differenceInDays(planDate, today);
  return diff >= 0 && diff <= 2;
}

export type EditWarning = 'none' | 'same_day' | 'locked';

export function getEditWarning(plan: DeliveryPlan): EditWarning {
  if (!canEditPlan(plan)) return 'locked';
  const today = startOfDay(new Date());
  const planDate = startOfDay(new Date(plan.planDate));
  return differenceInDays(planDate, today) === 0 ? 'same_day' : 'none';
}

import { ERROR_CODES } from '@ospm/shared';
import { badRequest } from '../common/errors';

export type ContributorPeriod = 'week' | 'month';

/** Calendar dates in Vietnam (UTC+7), with an exclusive upper bound. */
export function contributorRange(period: ContributorPeriod, date?: string, now = new Date()) {
  const offset = 7 * 60 * 60 * 1000;
  const anchor = date ?? new Date(now.getTime() + offset).toISOString().slice(0, 10);
  const start = new Date(`${anchor}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor) || !Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== anchor) {
    throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Ngày không hợp lệ');
  }
  if (period === 'month') start.setUTCDate(1);
  else start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const end = new Date(start);
  if (period === 'month') end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCDate(end.getUTCDate() + 7);
  return { from: new Date(start.getTime() - offset), to: new Date(end.getTime() - offset) };
}

import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import relativeTime from 'dayjs/plugin/relativeTime';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { fmtNumber } from './number';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.locale('vi');

/** API trả ISO 8601 UTC; giao diện hiển thị theo múi giờ Asia/Ho_Chi_Minh. */
export const TZ = 'Asia/Ho_Chi_Minh';
export const toVN = (v: string | Date | null | undefined) => (v ? dayjs(v).tz(TZ) : null);
export const fmtDateTime = (v?: string | Date | null) => toVN(v)?.format('DD/MM/YYYY HH:mm') ?? '—';
export const fmtDate = (v?: string | Date | null) => toVN(v)?.format('DD/MM/YYYY') ?? '—';
export const fromNow = (v?: string | Date | null) => (v ? dayjs(v).fromNow() : '—');

/** Nhóm "Hôm nay / Hôm qua / ngày" cho Recent activity */
export function dayLabel(v: string): string {
  const d = toVN(v)!;
  const today = dayjs().tz(TZ).startOf('day');
  if (d.isSame(today, 'day')) return 'Hôm nay';
  if (d.isSame(today.subtract(1, 'day'), 'day')) return 'Hôm qua';
  return d.format('DD/MM/YYYY');
}

export const fmtEstimate = (minutes?: number | null) => {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h ? `${fmtNumber(h)}h` : ''}${m ? `${fmtNumber(m)}m` : ''}`;
};

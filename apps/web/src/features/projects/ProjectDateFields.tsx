import { DatePicker, Form } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';

export interface ProjectDateValues { startDate?: Dayjs | null; endDate?: Dayjs | null }

export const projectDateInitialValues = (project: { startDate?: string | null; endDate?: string | null }) => ({
  startDate: project.startDate ? dayjs(project.startDate.slice(0, 10)) : null,
  endDate: project.endDate ? dayjs(project.endDate.slice(0, 10)) : null,
});

export const projectDatePayload = (values: ProjectDateValues) => ({
  startDate: values.startDate?.format('YYYY-MM-DD') ?? null,
  endDate: values.endDate?.format('YYYY-MM-DD') ?? null,
});

export function ProjectDateFields() {
  return <>
    <Form.Item name="startDate" label="Ngày bắt đầu">
      <DatePicker format="DD/MM/YYYY" placeholder="Chọn ngày bắt đầu" style={{ width: '100%' }} />
    </Form.Item>
    <Form.Item name="endDate" label="Ngày kết thúc" dependencies={['startDate']} rules={[
      ({ getFieldValue }) => ({
        validator(_, value: Dayjs | null) {
          const start: Dayjs | null = getFieldValue('startDate');
          return value && start && value.isBefore(start, 'day')
            ? Promise.reject(new Error('Ngày kết thúc không được trước ngày bắt đầu'))
            : Promise.resolve();
        },
      }),
    ]}>
      <DatePicker format="DD/MM/YYYY" placeholder="Chọn ngày kết thúc" style={{ width: '100%' }} />
    </Form.Item>
  </>;
}

import { Alert, Button, Select, Space, Typography } from 'antd';
import { useProjectStructure } from '../project-structure';

export interface IssueStructureValue { parentKey?: string | null; moduleIds: number[]; functionIds: number[] }
const empty: IssueStructureValue = { moduleIds: [], functionIds: [] };

/** Shared controlled selectors for item creation and inline editing. */
export function IssueStructureFields({ projectKey, value = empty, onChange, disabled, showEpic = true }: {
  projectKey?: string; value?: IssueStructureValue; onChange?: (value: IssueStructureValue) => void; disabled?: boolean; showEpic?: boolean;
}) {
  const { data, isLoading, error, refetch } = useProjectStructure(projectKey);
  const modules = data?.modules ?? [];
  const functions = data?.functions ?? [];
  const moduleIds = value.moduleIds ?? [];
  const functionIds = value.functionIds ?? [];
  const visibleModuleIds = [...new Set([...moduleIds, ...functions.filter((fn) => functionIds.includes(fn.id) && fn.moduleId != null).map((fn) => fn.moduleId!)])];
  // Keep selected functions visible so the user can remove an old assignment after metadata changes.
  const available = functions.filter((fn) => !visibleModuleIds.length || fn.moduleId == null || visibleModuleIds.includes(fn.moduleId) || functionIds.includes(fn.id));
  if (error) return <Alert type="warning" showIcon message="Không tải được Epic / Module / Function" action={<Button size="small" onClick={() => refetch()}>Thử lại</Button>} />;
  return <Space direction="vertical" size={12} style={{ width: '100%' }}>
    {showEpic && <div>
      <Typography.Text type="secondary">Epic</Typography.Text>
      <Select aria-label="Epic của item" allowClear showSearch optionFilterProp="label" loading={isLoading} disabled={disabled || isLoading} style={{ width: '100%' }}
        placeholder="Chọn Epic" value={value.parentKey ?? undefined} onChange={(parentKey) => onChange?.({ ...value, moduleIds, functionIds, parentKey: parentKey ?? null })}
        options={(data?.epics ?? []).map((epic) => ({ value: epic.key, label: `${epic.code} · ${epic.name}` }))} />
    </div>}
    <div>
      <Typography.Text type="secondary">Module</Typography.Text>
      <Select aria-label="Module của item" mode="multiple" allowClear showSearch optionFilterProp="label" loading={isLoading} disabled={disabled || isLoading} style={{ width: '100%' }}
        placeholder="Chọn Module" value={visibleModuleIds} onChange={(ids: number[]) => onChange?.({ ...value, moduleIds: ids.filter((id) => moduleIds.includes(id) || !visibleModuleIds.includes(id)), functionIds: functionIds.filter((id) => {
          const fn = functions.find((entry) => entry.id === id);
          return fn?.moduleId == null || ids.includes(fn.moduleId);
        }) })} options={modules.map((module) => ({ value: module.id, label: `${module.code} · ${module.name}` }))} />
    </div>
    <div>
      <Typography.Text type="secondary">Function</Typography.Text>
      <Select aria-label="Function của item" mode="multiple" allowClear showSearch optionFilterProp="label" loading={isLoading} disabled={disabled || isLoading} style={{ width: '100%' }}
        placeholder="Chọn Function liên quan" value={functionIds} onChange={(ids: number[]) => onChange?.({ ...value, functionIds: ids, moduleIds })}
        options={available.map((fn) => ({ value: fn.id, label: `${fn.code} · ${fn.name}` }))} />
    </div>
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>Chọn Function sẽ kèm Module tương ứng. Bỏ Module sẽ bỏ các Function thuộc Module đó khỏi item.</Typography.Text>
  </Space>;
}

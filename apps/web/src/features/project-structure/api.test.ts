import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http } from '../../api/http';
import { getProjectStructure, saveStructure, structureFormValues } from './api';
vi.mock('../../api/http', () => ({ http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
describe('project structure API', () => {
  it('keeps runtime options and management requests separate', async () => {
    vi.mocked(http.get).mockResolvedValue({ data: { modules: [], functions: [], epics: [] } });
    await getProjectStructure('QA');
    await getProjectStructure('QA', true);
    expect(http.get).toHaveBeenNthCalledWith(1, '/api/v1/projects/QA/structure/options');
    expect(http.get).toHaveBeenNthCalledWith(2, '/api/v1/projects/QA/structure');
  });
  it('sends empty scope to clear links and allows unassigned legacy Functions', () => {
    saveStructure('QA', 'function', { code: 'F1', name: 'Legacy' }, 22);
    expect(http.patch).toHaveBeenCalledWith('/api/v1/requirements/22', { code: 'F1', name: 'Legacy', moduleId: null, epicIds: [] });
    saveStructure('QA', 'epic', { code: 'E1', name: 'Epic' }, 33);
    expect(http.patch).toHaveBeenCalledWith('/api/v1/requirements/33', { code: 'E1', name: 'Epic', moduleIds: [], functionIds: [] });
  });
  it('does not materialize inferred Epic scope on a name-only save', () => {
    const row = { id: 100, requirementId: 33, key: 'QA-100', code: 'E1', name: 'Epic', moduleIds: [7, 8], functionIds: [21, 22], explicitModuleIds: [7], explicitFunctionIds: [21], version: 1 };
    const values = structureFormValues(row);
    saveStructure('QA', 'epic', { ...values, name: 'Renamed' }, row.requirementId);
    expect(http.patch).toHaveBeenCalledWith('/api/v1/requirements/33', { code: 'E1', name: 'Renamed', moduleIds: [7], functionIds: [21] });
    values.moduleIds?.push(9);
    expect(row.explicitModuleIds).toEqual([7]);
    expect(structureFormValues(row).moduleIds).toEqual([7]);
  });
  it('does not materialize inferred Function Epics on a name-only save', () => {
    const row = { id: 22, code: 'F1', name: 'Function', moduleId: null, epicIds: [33, 44], explicitEpicIds: [33] };
    const values = structureFormValues(row);
    saveStructure('QA', 'function', { ...values, name: 'Renamed' }, row.id);
    expect(http.patch).toHaveBeenCalledWith('/api/v1/requirements/22', { code: 'F1', name: 'Renamed', moduleId: null, epicIds: [33] });
    expect(structureFormValues()).toMatchObject({ moduleIds: [], epicIds: [], functionIds: [] });
  });
  it('creates Epic metadata through the canonical requirement bridge', () => {
    saveStructure('QA', 'epic', { code: 'E1', name: 'Epic', moduleIds: [7], functionIds: [22] });
    expect(http.post).toHaveBeenCalledWith('/api/v1/projects/QA/requirements', { kind: 'epic', code: 'E1', name: 'Epic', moduleIds: [7], functionIds: [22] });
  });
});

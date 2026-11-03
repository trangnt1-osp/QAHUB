import { useQuery } from '@tanstack/react-query';
import { http } from '../../api/http';

export interface ProjectModule { id: number; code: string; name: string; description?: string | null }
export interface ProjectFunction { id: number; code: string; name: string; moduleId: number | null; epicIds: number[]; explicitEpicIds?: number[] }
export interface ProjectEpic { id: number; requirementId: number; key: string; code: string; name: string; moduleIds: number[]; functionIds: number[]; explicitModuleIds?: number[]; explicitFunctionIds?: number[]; version: number }
export interface ProjectStructure { modules: ProjectModule[]; functions: ProjectFunction[]; epics: ProjectEpic[] }
export type StructureKind = 'epic' | 'module' | 'function';
export interface StructureValues { code: string; name: string; description?: string | null; moduleId?: number | null; moduleIds?: number[]; epicIds?: number[]; functionIds?: number[] }
/** Aggregate scope is for display; editing must preserve only explicitly managed links. */
export function structureFormValues(row?: ProjectModule | ProjectFunction | ProjectEpic): StructureValues {
  if (!row) return { code: '', name: '', moduleId: null, moduleIds: [], epicIds: [], functionIds: [] };
  if ('requirementId' in row) return { code: row.code, name: row.name, moduleIds: [...(row.explicitModuleIds ?? [])], functionIds: [...(row.explicitFunctionIds ?? [])] };
  if ('epicIds' in row) return { code: row.code, name: row.name, moduleId: row.moduleId, epicIds: [...(row.explicitEpicIds ?? [])] };
  return { code: row.code, name: row.name, description: row.description };
}
export const projectStructureKey = (projectKey?: string) => ['project-structure', projectKey] as const;
export const getProjectStructure = (projectKey: string, management = false) => http.get<ProjectStructure>(`/api/v1/projects/${encodeURIComponent(projectKey)}/structure${management ? '' : '/options'}`).then(({ data }) => data);
/** Runtime metadata access is deliberately independent of the management permission. */
export const useProjectStructure = (projectKey?: string) => useQuery({ queryKey: projectStructureKey(projectKey), queryFn: () => getProjectStructure(projectKey!), enabled: !!projectKey, staleTime: 0 });
export function saveStructure(projectKey: string, kind: StructureKind, values: StructureValues, id?: number) {
  if (kind === 'module') {
    const url = `/api/v1/projects/${encodeURIComponent(projectKey)}/modules`;
    const data = { code: values.code, name: values.name, description: values.description ?? '' };
    return id ? http.patch(`${url}/${id}`, data) : http.post(url, data);
  }
  const data = kind === 'epic'
    ? { code: values.code, name: values.name, moduleIds: values.moduleIds ?? [], functionIds: values.functionIds ?? [] }
    : { code: values.code, name: values.name, moduleId: values.moduleId ?? null, epicIds: values.epicIds ?? [] };
  return id ? http.patch(`/api/v1/requirements/${id}`, data) : http.post(`/api/v1/projects/${encodeURIComponent(projectKey)}/requirements`, { ...data, kind });
}
export const deleteStructure = (projectKey: string, kind: StructureKind, id: number) => http.delete(kind === 'module' ? `/api/v1/projects/${encodeURIComponent(projectKey)}/modules/${id}` : `/api/v1/requirements/${id}`);

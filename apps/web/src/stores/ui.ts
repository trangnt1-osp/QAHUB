import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  projectList: { current: number; pageSize: number; scrollTop: number };
  setProjectList: (value: Partial<UiState['projectList']>) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** Bộ lọc assignee theo dự án (giữ khi chuyển tab) */
  assigneeFilter: Record<string, number[]>;
  setAssigneeFilter: (projectKey: string, ids: number[]) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      projectList: { current: 1, pageSize: 10, scrollTop: 0 },
      setProjectList: (value) => set((s) => ({ projectList: { ...s.projectList, ...value } })),
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      assigneeFilter: {},
      setAssigneeFilter: (projectKey, ids) => set((s) => ({ assigneeFilter: { ...s.assigneeFilter, [projectKey]: ids } })),
    }),
    { name: 'ospm-ui' },
  ),
);

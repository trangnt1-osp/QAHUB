import { AgGridReact } from 'ag-grid-react';
import { ColDef, GridApi, GridReadyEvent, IDatasource, themeQuartz, CellValueChangedEvent, ValueSetterParams, ValueFormatterParams, ICellRendererParams } from 'ag-grid-community';
import { App } from 'antd';
import { Link } from 'react-router-dom';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { TEST_CASE_PRIORITIES, TEST_CASE_STATUSES } from '@ospm/shared';
import { getTestCase, listTestCaseIds, listTestCases, updateTestCase } from '../../api/generated/api';
import { errorCode, errorMessage } from '../../api/http';
import type { TestCaseRow } from '../../api/models';
import { fmtDateTime } from '../../lib/date';
import { fmtNumber } from '../../lib/number';
import { PRIORITY_LABEL, STATUS_HEX, STATUS_LABEL } from './labels';

export interface GridFilters { functionId?: string; epicId?: string; q?: string; status?: string[]; categoryId?: string[]; priority?: string[] }
export interface GridHandle { api: () => GridApi | null; updateRow: (row: Partial<TestCaseRow> & { id: number }) => void }

/** Giao diện/màu sắc AG Grid khớp Ant Design (mục 10). */
const gridTheme = themeQuartz.withParams({ accentColor: '#f51d53', fontFamily: "Inter, -apple-system, 'Segoe UI', Roboto, sans-serif", borderRadius: 6, rowHeight: 40, headerHeight: 40, wrapperBorderRadius: 6 });

// Renderer nhẹ: span thuần, không bọc component Ant Design (mục 10)
const PriorityCell = (p: ICellRendererParams) => {
  const v = p.value as string;
  const up = v === 'critical' || v === 'high';
  return <span style={{ color: up ? '#f5222d' : v === 'low' ? '#1677ff' : '#fa8c16' }}>{up ? '▲' : v === 'low' ? '▼' : '='} {PRIORITY_LABEL[v] ?? v}</span>;
};
const StatusCell = (p: ICellRendererParams) => (
  <span style={{ background: `${STATUS_HEX[p.value]}22`, color: STATUS_HEX[p.value], padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500 }}>{STATUS_LABEL[p.value] ?? p.value}</span>
);
const BugCell = (p: ICellRendererParams<TestCaseRow>) => {
  const bugs = p.data?.bugs ?? [];
  if (!bugs.length) return null;
  return (
    <span>
      {bugs.slice(0, 2).map((b, i) => <span key={b.id}>{i > 0 && ', '}<Link to={`/browse/${b.key}`} onClick={(e) => e.stopPropagation()}>{b.key}</Link></span>)}
      {bugs.length > 2 && <span className="muted"> +{fmtNumber(bugs.length - 2)}</span>}
    </span>
  );
};

const SORT_FIELD: Record<string, string> = { code: 'code', priority: 'priority', status: 'status', updatedAt: 'updatedAt' };

interface Props {
  projectKey: string;
  filters: GridFilters;
  categories: { id: number; name: string }[];
  canEdit: boolean;
  reloadToken: number;
  hiddenCols: string[];
  onOpen: (id: number) => void;
  onSelection: (ids: number[]) => void;
  onCount?: (n: number | null) => void;
  onSaved?: () => void;
  me?: { id: number; displayName: string } | null;
}

/**
 * Bảng chính tab Test cases (AG Grid Community).
 * - Xem một function: Client-Side Row Model, tải nối tiếp 500 dòng/trang rồi lọc/sắp xếp tại trình duyệt.
 * - Xem cả epic/dự án: Infinite Row Model, khối 200 dòng, lọc/sắp xếp ở server.
 */
export const TestCaseGrid = forwardRef<GridHandle, Props>(function TestCaseGrid(
  { projectKey, filters, categories, canEdit, reloadToken, hiddenCols, onOpen, onSelection, onCount, onSaved, me }, ref,
) {
  const apiRef = useRef<GridApi | null>(null);
  const { message } = App.useApp();
  const clientSide = !!filters.functionId;
  const matchIds = useRef<Set<number> | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const loadSeq = useRef(0);

  useImperativeHandle(ref, () => ({
    api: () => apiRef.current,
    updateRow: (row) => { const n = apiRef.current?.getRowNode(String(row.id)); if (n) n.setData({ ...n.data, ...row }); },
  }));

  const catNames = useMemo(() => categories.map((c) => c.name), [categories]);

  const columnDefs = useMemo<ColDef<TestCaseRow>[]>(() => [
    { colId: 'stt', headerName: 'STT', pinned: 'left', width: 80, sortable: false, editable: false,
      valueGetter: (p: any) => p.node?.rowIndex == null ? '' : p.node.rowIndex + 1, valueFormatter: (p: ValueFormatterParams) => typeof p.value === 'number' ? fmtNumber(p.value) : '' },
    { colId: 'code', field: 'code', headerName: 'Checklist ID', pinned: 'left', width: 200, cellStyle: { fontWeight: 700 }, sortable: true,
      cellRenderer: (p: ICellRendererParams) => <a onClick={() => onOpen(p.data.id)}>{p.value}</a> },
    { colId: 'priority', field: 'priority', headerName: 'Priority', width: 120, sortable: true, editable: canEdit, cellRenderer: PriorityCell, cellEditor: 'agSelectCellEditor', cellEditorParams: { values: [...TEST_CASE_PRIORITIES] } },
    { colId: 'category', headerName: 'Category', width: 150, editable: canEdit, valueGetter: (p: any) => p.data?.categoryName ?? '', cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['', ...catNames] },
      valueSetter: (p: ValueSetterParams<TestCaseRow>) => { const c = categories.find((x) => x.name === p.newValue); p.data.categoryName = c?.name ?? null; p.data.categoryId = c?.id ?? null; return true; } },
    { colId: 'title', field: 'title', headerName: 'Checklist Item', flex: 1, minWidth: 280, editable: canEdit, tooltipField: 'title' },
    { colId: 'preconditions', field: 'preconditions', headerName: 'Pre-conditions', width: 220, tooltipField: 'preconditions' },
    { colId: 'stepCount', field: 'stepCount', headerName: 'Số bước', width: 90, type: 'rightAligned', valueFormatter: (p: ValueFormatterParams) => fmtNumber(p.value) },
    { colId: 'status', field: 'status', headerName: 'Status', width: 130, sortable: true, editable: canEdit, cellRenderer: StatusCell, cellEditor: 'agSelectCellEditor', cellEditorParams: { values: [...TEST_CASE_STATUSES] } },
    { colId: 'bugs', headerName: 'Link Bug', width: 170, cellRenderer: BugCell },
    { colId: 'notes', field: 'notes', headerName: 'Notes', width: 220, editable: canEdit, tooltipField: 'notes' },
    { colId: 'updatedAt', headerName: 'Cập nhật', width: 200, sortable: true, valueGetter: (p: any) => (p.data ? `${fmtDateTime(p.data.updatedAt)}${p.data.updatedBy ? ` · ${p.data.updatedBy.displayName}` : ''}` : '') },
  ].map((c) => ({ ...c, hide: hiddenCols.includes(c.colId!), sortable: clientSide ? c.sortable ?? true : c.sortable ?? false })) as ColDef<TestCaseRow>[], [catNames, categories, canEdit, hiddenCols, clientSide, onOpen]);

  // ---- Client-Side: tải nối tiếp tới hết ----
  const loadAll = useCallback(async (api: GridApi) => {
    const seq = ++loadSeq.current;
    api.setGridOption('rowData', []);
    api.setGridOption('loading', true);
    let cursor: string | undefined;
    let total = 0;
    try {
      do {
        const r = await listTestCases(projectKey, { functionId: filtersRef.current.functionId, limit: 500, cursor } as any);
        if (seq !== loadSeq.current) return;
        api.applyTransactionAsync({ add: r.items });
        total += r.items.length;
        cursor = r.nextCursor ?? undefined;
        api.setGridOption('loading', false);
      } while (cursor);
      onCount?.(total);
    } catch (e) { message.error(errorMessage(e)); api.setGridOption('loading', false); }
  }, [projectKey, message, onCount]);

  // ---- Infinite: server filter + sort, cursor theo khối ----
  const makeDatasource = useCallback((): IDatasource => {
    const cursorAt = new Map<number, string | undefined>([[0, undefined]]);
    let currentSort: string | undefined;
    return {
      async getRows(params) {
        try {
          const sort = params.sortModel[0];
          const sortParam = sort && SORT_FIELD[sort.colId] ? `${SORT_FIELD[sort.colId]}${sort.sort === 'desc' ? ':desc' : ''}` : undefined;
          if (sortParam !== currentSort) {
            cursorAt.clear();
            cursorAt.set(0, undefined);
            currentSort = sortParam;
          }
          let offset = Math.max(...[...cursorAt.keys()].filter((row) => row <= params.startRow));
          // Cần cursor của khối này; nếu chưa có thì tải nối tiếp từ khối gần nhất đã biết
          while (!cursorAt.has(params.startRow)) {
            const f = filtersRef.current;
            const r = await listTestCases(projectKey, { ...f, sort: sortParam, limit: 200, cursor: cursorAt.get(offset) } as any);
            offset += r.items.length;
            if (!r.nextCursor) { params.successCallback([], offset); return; }
            cursorAt.set(offset, r.nextCursor);
          }
          const f = filtersRef.current;
          const r = await listTestCases(projectKey, { ...f, sort: sortParam, limit: params.endRow - params.startRow, cursor: cursorAt.get(params.startRow) } as any);
          const end = params.startRow + r.items.length;
          if (r.nextCursor) cursorAt.set(end, r.nextCursor);
          params.successCallback(r.items, r.nextCursor ? undefined : end);
          onCount?.(r.nextCursor ? null : end);
        } catch (e) { message.error(errorMessage(e)); params.failCallback(); }
      },
    };
  }, [projectKey, message, onCount]);

  const reload = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    api.paginationGoToFirstPage();
    if (clientSide) {
      matchIds.current = null;
      const f = filtersRef.current;
      if (f.q) { try { matchIds.current = new Set((await listTestCaseIds(projectKey, { functionId: f.functionId, q: f.q } as any)).ids); } catch { /* bỏ qua */ } }
      await loadAll(api);
      api.onFilterChanged();
    } else {
      api.setGridOption('rowData', undefined);
      api.setGridOption('datasource', makeDatasource());
    }
  }, [clientSide, loadAll, makeDatasource, projectKey]);

  const filterKey = JSON.stringify(filters);
  useEffect(() => { void reload(); }, [projectKey, filterKey, reloadToken, clientSide]);

  // Bộ lọc ngoài cho chế độ client (status/category/priority/q)
  const isExternalFilterPresent = useCallback(() => clientSide && !!(filters.status?.length || filters.categoryId?.length || filters.priority?.length || filters.q), [clientSide, filters]);
  const doesExternalFilterPass = useCallback((node: { data?: TestCaseRow }) => {
    const d = node.data;
    if (!d) return true;
    const f = filtersRef.current;
    if (f.status?.length && !f.status.includes(d.status)) return false;
    if (f.priority?.length && !f.priority.includes(d.priority)) return false;
    if (f.categoryId?.length && !f.categoryId.includes(String(d.categoryId))) return false;
    if (f.q && matchIds.current && !matchIds.current.has(d.id)) return false;
    return true;
  }, []);

  const onCellValueChanged = async (e: CellValueChangedEvent<TestCaseRow>) => {
    if (!canEdit) return;
    const row = e.data;
    const colId = e.column.getColId();
    const body: Record<string, unknown> = { version: row.version };
    if (colId === 'category') body.categoryId = row.categoryId;
    else body[colId] = e.newValue;
    const revert = () => {
      if (colId === 'category') { const old = categories.find((c) => c.name === e.oldValue); e.node.setData({ ...row, categoryName: old?.name ?? null, categoryId: old?.id ?? null }); }
      else e.node.setData({ ...row, [colId]: e.oldValue });
    };
    try {
      const res = await updateTestCase(String(row.id), body as any);
      e.node.setData({ ...e.node.data!, version: res.version, updatedAt: res.updatedAt, updatedBy: me ? { id: me.id, displayName: me.displayName } : e.node.data!.updatedBy });
      onSaved?.();
    } catch (err) {
      if (errorCode(err) === 'VERSION_CONFLICT') {
        const who = (err as any).response?.data?.details?.updatedBy?.displayName;
        message.warning(who ? `Dòng này vừa được ${who} sửa trước. Đã hoàn tác thay đổi của bạn.` : 'Dòng này vừa được người khác sửa. Đã hoàn tác thay đổi của bạn.');
        try { const fresh = await getTestCase(String(row.id)); e.node.setData({ ...row, title: fresh.title, priority: fresh.priority, status: fresh.status, notes: fresh.notes, categoryId: fresh.categoryId, categoryName: fresh.category?.name ?? null, version: fresh.version }); }
        catch { revert(); }
      } else { revert(); message.error(errorMessage(err)); }
    }
  };

  return (
    <div style={{ height: 'calc(100vh - 380px)', minHeight: 360, width: '100%' }} data-testid="tc-grid">
      <AgGridReact<TestCaseRow>
        theme={gridTheme}
        columnDefs={columnDefs}
        defaultColDef={{ resizable: true, suppressMovable: false }}
        rowModelType={clientSide ? 'clientSide' : 'infinite'}
        pagination
        paginationNumberFormatter={(params) => fmtNumber(params.value)}
        localeText={{ thousandSeparator: '.', decimalSeparator: ',' }}
        paginationPageSize={10}
        paginationPageSizeSelector={[10, 20, 50, 100]}
        cacheBlockSize={200}
        maxConcurrentDatasourceRequests={1}
        infiniteInitialRowCount={200}
        rowHeight={40}
        headerHeight={40}
        animateRows={false}
        rowBuffer={20}
        getRowId={(p) => String(p.data.id)}
        asyncTransactionWaitMillis={50}
        rowSelection={{ mode: 'multiRow', checkboxes: true, headerCheckbox: clientSide, enableClickSelection: false }}
        onSelectionChanged={(e) => onSelection(e.api.getSelectedRows().map((r) => r.id))}
        onModelUpdated={(e) => e.api.refreshCells({ columns: ['stt'], force: true })}
        onGridReady={(e: GridReadyEvent) => { apiRef.current = e.api; void reload(); }}
        onCellValueChanged={canEdit ? onCellValueChanged : undefined}
        onCellDoubleClicked={(e) => { if (['preconditions', 'stepCount', 'bugs'].includes(e.column.getColId()) && e.data) onOpen(e.data.id); }}
        isExternalFilterPresent={isExternalFilterPresent}
        doesExternalFilterPass={doesExternalFilterPass}
        singleClickEdit={false}
        stopEditingWhenCellsLoseFocus
        tooltipShowDelay={400}
        overlayNoRowsTemplate="Chưa có test case"
      />
    </div>
  );
});

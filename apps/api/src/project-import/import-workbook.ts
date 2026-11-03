import ExcelJS from 'exceljs';

export type ImportScope = 'structure' | 'backlog';
export type ImportEntity = 'module' | 'epic' | 'function' | 'backlog';
export type TemplateKind = ImportEntity | 'all';
export interface ImportMessage { sheet: string; row?: number; column?: string; message: string }
export interface ImportSourceRow { sheet: string; row: number; entity: ImportEntity; values: Record<string, string | number> }
export interface ParsedProjectWorkbook { rows: ImportSourceRow[]; errors: ImportMessage[]; warnings: ImportMessage[] }
type Column = { key: string; label: string; aliases?: readonly string[]; required?: boolean; note?: string };
const column = (key: string, label: string, alias: string, required = false): Column => ({ key, label, aliases: [alias], required,
  note: required ? 'Bắt buộc có cột này. Mã và tên bắt buộc cho cấu trúc; tiêu đề bắt buộc khi tạo mới.' : 'Không bắt buộc. Để trống để giữ giá trị hiện tại; [CLEAR] để xóa giá trị tùy chọn.' });
export const IMPORT_COLUMNS: Record<ImportEntity, readonly Column[]> = {
  module: [column('code', 'Mã Module', 'Code', true), column('name', 'Tên Module', 'Name', true), column('description', 'Mô tả', 'Description')],
  epic: [column('code', 'Mã Epic', 'Code', true), column('name', 'Tên Epic', 'Name', true), column('moduleCodes', 'Mã các Module', 'Module Codes'), column('functionCodes', 'Mã các Function', 'Function Codes')],
  function: [column('code', 'Mã Function', 'Code', true), column('name', 'Tên Function', 'Name', true), column('moduleCode', 'Mã Module', 'Module Code'), column('epicCodes', 'Mã các Epic', 'Epic Codes'), column('traceRef', 'Tham chiếu', 'Trace Ref'), column('sources', 'Đường dẫn nguồn', 'Sources')],
  backlog: [column('ref', 'Tham chiếu nội bộ', 'Ref'), column('itemKey', 'Mã công việc', 'Item Key'), column('type', 'Loại', 'Type'), column('title', 'Tiêu đề', 'Title', true), column('parent', 'Công việc cha', 'Parent'), column('epicCode', 'Mã Epic', 'Epic Code'), column('moduleCodes', 'Mã các Module', 'Module Codes'), column('functionCodes', 'Mã các Function', 'Function Codes'), column('period', 'Kỳ làm việc', 'Period'), column('assignee', 'Email người phụ trách', 'Assignee'), column('priority', 'Ưu tiên', 'Priority'), column('status', 'Trạng thái', 'Status'), column('estimateMinutes', 'Ước tính (phút)', 'Estimate Minutes'), column('dueDate', 'Ngày hết hạn', 'Due Date'), column('description', 'Mô tả', 'Description')],
};
const SHEETS: Record<string, ImportEntity> = { Modules: 'module', Epics: 'epic', Functions: 'function', Backlog: 'backlog' };
const IGNORED = new Set(['Hướng dẫn', 'Instructions', '_Lists']);
const normalize = (value: string) => value.trim().toLocaleLowerCase('en-US');

// Check central-directory expansion sizes before handing compressed XML to ExcelJS.
function checkArchive(buffer: Buffer): void {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid XLSX file.');
  let end = buffer.length - 22;
  while (end >= Math.max(0, buffer.length - 65557) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < Math.max(0, buffer.length - 65557)) throw new Error('Invalid XLSX archive.');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16), expanded = 0;
  if (count > 1000) throw new Error('Workbook archive has too many entries.');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid XLSX directory.');
    expanded += buffer.readUInt32LE(offset + 24);
    if (expanded > 50 * 1024 * 1024) throw new Error('Workbook expansion exceeds 50 MB.');
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}

export async function parseProjectWorkbook(buffer: Buffer, scope: ImportScope): Promise<ParsedProjectWorkbook> {
  const result: ParsedProjectWorkbook = { rows: [], errors: [], warnings: [] };
  const error = (sheet: string, message: string, row?: number, column?: string) => result.errors.push({ sheet, message, ...(row === undefined ? {} : { row }), ...(column ? { column } : {}) });
  if (buffer.length > 10 * 1024 * 1024) { error('', 'Upload exceeds 10 MB.'); return result; }
  const book = new ExcelJS.Workbook();
  try { checkArchive(buffer); await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]); }
  catch { error('', 'Invalid or unsafe XLSX workbook.'); return result; }
  let count = 0;
  for (const sheet of book.worksheets) {
    if (sheet.rowCount > 10000 || sheet.columnCount > 100) { error(sheet.name, 'Worksheet dimensions exceed safe limits.'); continue; }
    const entity = SHEETS[sheet.name];
    if (!entity && !IGNORED.has(sheet.name)) { error(sheet.name, 'Unknown worksheet.'); continue; }
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (cell.value && typeof cell.value === 'object' && ('formula' in cell.value || 'sharedFormula' in cell.value)) error(sheet.name, 'Formulas are not allowed.', row.number, cell.address);
    }));
    if (!entity) continue;
    const columns = IMPORT_COLUMNS[entity];
    const aliases = new Map(columns.flatMap((c) => [c.key, c.label, ...(c.aliases ?? [])].map((label) => [normalize(label), c.key] as const)));
    const headers = new Map<number, string>();
    const seen = new Set<string>();
    sheet.getRow(1).eachCell((cell, index) => {
      const label = String(cell.text ?? '').trim();
      if (!label) return;
      const key = aliases.get(normalize(label));
      if (!key) { error(sheet.name, `Unknown column: ${label}.`, 1, label); return; }
      if (seen.has(key)) error(sheet.name, `Duplicate column: ${label}.`, 1, key);
      seen.add(key); headers.set(index, key);
    });
    for (const c of columns) if (c.required && !seen.has(c.key)) error(sheet.name, `Required header missing: ${c.key}.`, 1, c.key);
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      let populated = false;
      row.eachCell((cell) => { if (cell.value !== null && String(cell.text).trim()) populated = true; });
      if (!populated) return;
      count++;
      if (count > 5000) return;
      if (scope === 'structure' && entity === 'backlog') { error(sheet.name, 'Backlog data is not permitted in structure scope.', rowNumber); return; }
      const values: Record<string, string | number> = Object.fromEntries(columns.map((c) => [c.key, '']));
      row.eachCell((cell, index) => {
        if (!headers.has(index) && cell.text.trim()) error(sheet.name, 'Data has no recognized column header.', rowNumber, cell.address);
      });
      for (const [index, key] of headers) {
        const value = row.getCell(index).value;
        if (value == null) values[key] = '';
        else if (typeof value === 'string') values[key] = value.trim();
        else if (typeof value === 'number' && Number.isFinite(value)) values[key] = value;
        else if (value instanceof Date && Number.isFinite(value.getTime())) values[key] = value.toISOString().slice(0, 10);
        else error(sheet.name, 'Unsupported cell value; use text, numbers or dates.', rowNumber, key);
      }
      result.rows.push({ sheet: sheet.name, row: rowNumber, entity, values });
    });
  }
  if (count > 5000) error('', 'Workbook exceeds 5,000 data rows.');
  if (scope === 'backlog' && !result.rows.some((r) => r.entity === 'backlog')) error('Backlog', 'At least one Backlog row is required.');
  return result;
}

export async function buildProjectImportTemplate(kind: TemplateKind, context?: { projectKey?: string; statuses?: string[]; periods?: string[] }): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const instructions = book.addWorksheet('Hướng dẫn');
  const notes = [
    'NHẬP CẤU TRÚC VÀ BACKLOG', `Dự án: ${context?.projectKey ?? ''}`,
    'Chỉ nhập dữ liệu tại các trang Modules, Epics, Functions, Backlog. Epic không bắt buộc.',
    'Mã phân biệt chữ hoa/thường. Danh sách mã: ngăn cách bằng dấu phẩy hoặc chấm phẩy; nguồn: mỗi dòng một đường dẫn.',
    'Ô trống giữ giá trị hiện tại khi cập nhật; [CLEAR] xóa giá trị tùy chọn. Không hỗ trợ công thức.',
    'Backlog: itemKey xác định công việc cập nhật; ref tham chiếu cục bộ cho công việc mới. parent nhận ref hoặc mã công việc.',
    'Backlog mới: type mặc định task; các loại: epic, story, task, bug, subtask. priority mặc định medium; các mức: highest, high, medium, low, lowest. status dùng trạng thái mặc định của dự án. Ngày: YYYY-MM-DD; ước tính: số phút.',
    'Ví dụ (không được nhập): Module M01 / Đăng nhập; Function F01 / Đăng nhập bằng email / Module M01.',
    'Ví dụ Backlog: ref=T1; title=Xây dựng đăng nhập; type=Task; moduleCodes=M01; estimateMinutes=60.',
    'Giới hạn: 10 MB, tổng cộng 5.000 dòng dữ liệu. Không xóa dữ liệu hiện có khi nhập.',
    `Trạng thái: ${context?.statuses?.join(', ') ?? ''}`, `Kỳ làm việc: ${context?.periods?.join(', ') ?? ''}`,
  ];
  instructions.getColumn(1).width = 120;
  notes.forEach((note) => instructions.addRow([note]));
  for (const [name, entity] of Object.entries(SHEETS)) {
    if (kind !== 'backlog' && !(kind === 'all' ? entity !== 'backlog' : kind === entity)) continue;
    const sheet = book.addWorksheet(name);
    sheet.addRow(IMPORT_COLUMNS[entity].map((c) => c.label));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getRow(1).font = { bold: true };
    IMPORT_COLUMNS[entity].forEach((c, i) => {
      sheet.getColumn(i + 1).width = Math.max(20, c.label.length + 4);
      sheet.getCell(1, i + 1).note = `${c.aliases?.[0] ?? c.key} (${c.key})\n${c.note}`;
      if (c.key === 'dueDate') sheet.getColumn(i + 1).numFmt = 'yyyy-mm-dd';
      if (c.key === 'estimateMinutes') sheet.getColumn(i + 1).numFmt = '0.##';
    });
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

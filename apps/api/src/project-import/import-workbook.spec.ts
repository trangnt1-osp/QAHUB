import ExcelJS from 'exceljs';
import { buildProjectImportTemplate, parseProjectWorkbook } from './import-workbook';

async function file(sheets: Record<string, unknown[][] | undefined>): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) if (rows) book.addWorksheet(name).addRows(rows);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe('project import workbook', () => {
  it.each(['module', 'epic', 'function', 'all', 'backlog'] as const)('round trips empty %s templates without example data', async (kind) => {
    const buffer = await buildProjectImportTemplate(kind);
    const result = await parseProjectWorkbook(buffer, kind === 'backlog' ? 'backlog' : 'structure');
    expect(result.rows).toEqual([]);
    expect(result.errors.filter((e) => !e.message.includes('Backlog row'))).toEqual([]);
  });
  it('normalizes aliases, dates and blank cells, retaining numeric types without requiring Epic', async () => {
    const result = await parseProjectWorkbook(await file({
      Backlog: [['Title', 'Estimate Minutes', 'Due Date', 'Module Codes'], ['Work', 30, new Date('2026-11-03T00:00:00Z'), 'M']],
      Functions: [['Code', 'Name', 'Module Code'], ['F', 'Feature', 'M']],
      Modules: [['Code', 'Name', 'Description'], ['M', 'Module', null], [' ', ' ', ' ']],
    }), 'backlog');
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => r.entity)).toEqual(['backlog', 'function', 'module']);
    expect(result.rows[0].values).toMatchObject({ title: 'Work', estimateMinutes: 30, dueDate: '2026-11-03' });
    expect(result.rows[2].values.description).toBe('');
  });
  it.each([
    { Modules: [['Code', 'Name', 'Mystery'], ['M', 'A', 'x']] },
    { Modules: [['Code', 'Name', 'code'], ['M', 'A', 'x']] },
    { Modules: [['Code'], ['M']] },
    { Unexpected: [['Code', 'Name'], ['M', 'A']] },
    { Modules: [['Code', 'Name'], ['M', { formula: '1+1', result: 2 }]] },
  ])('rejects invalid schema or formulas %#', async (sheets) => {
    expect((await parseProjectWorkbook(await file(sheets), 'structure')).errors.length).toBeGreaterThan(0);
  });
  it('rejects malformed and oversized files', async () => {
    expect((await parseProjectWorkbook(Buffer.from('invalid'), 'structure')).errors.length).toBeGreaterThan(0);
    expect((await parseProjectWorkbook(Buffer.alloc(10 * 1024 * 1024 + 1), 'structure')).errors.length).toBeGreaterThan(0);
  });
  it('rejects declared archive expansion before loading XML', async () => {
    const buffer = await file({ Modules: [['Code', 'Name']] });
    const directory = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    buffer.writeUInt32LE(60 * 1024 * 1024, directory + 24);
    expect((await parseProjectWorkbook(buffer, 'structure')).errors.length).toBeGreaterThan(0);
  });
  it('rejects shared formulas, unsupported typed values and unheaded data', async () => {
    const buffer = await file({ Modules: [['Code', 'Name'], ['M', { formula: '1+1', result: 2 }], ['N', { sharedFormula: 'B2', result: 2 }], ['B', true], ['X', 'Name', 'unheaded']] });
    const result = await parseProjectWorkbook(buffer, 'structure');
    expect(result.errors.filter((e) => e.message.includes('Formulas'))).toHaveLength(2);
    expect(result.errors.some((e) => e.row === 4 && e.message.includes('Unsupported'))).toBe(true);
    expect(result.errors.some((e) => e.row === 5 && e.message.includes('header'))).toBe(true);
  });
  it('preserves clear markers and exact case in identifiers for domain validation', async () => {
    const result = await parseProjectWorkbook(await file({ Functions: [['Code', 'Name', 'Epic Codes'], [' fOne ', ' Feature ', '[CLEAR]']] }), 'structure');
    expect(result.errors).toEqual([]);
    expect(result.rows[0].values).toMatchObject({ code: 'fOne', name: 'Feature', epicCodes: '[CLEAR]' });
  });
  it('enforces the aggregate data row limit', async () => {
    const rows = Array.from({ length: 2501 }, (_, i) => [`C${i}`, 'Name']);
    const result = await parseProjectWorkbook(await file({ Modules: [['Code', 'Name'], ...rows], Functions: [['Code', 'Name'], ...rows] }), 'structure');
    expect(result.errors.some((e) => e.message.includes('5,000'))).toBe(true);
  });
  it('rejects Backlog data under structure scope and requires it under backlog scope', async () => {
    expect((await parseProjectWorkbook(await file({ Backlog: [['Title'], ['Task']] }), 'structure')).errors.length).toBeGreaterThan(0);
    expect((await parseProjectWorkbook(await file({ Modules: [['Code', 'Name']] }), 'backlog')).errors.length).toBeGreaterThan(0);
  });
});

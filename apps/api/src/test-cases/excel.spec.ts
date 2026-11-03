import { splitSteps } from './excel.service';
import { formatCode } from './test-cases.service';
import { progressOf } from './requirements.service';

describe('Excel & test case helpers', () => {
  it('splitSteps tách "1. a\\n2. b" thành cặp bước/expected', () => {
    expect(splitSteps('1. Mở trang\n2. Bấm lọc', '1. Thấy bảng\n2. Lọc đúng')).toEqual([
      { action: 'Mở trang', expected: 'Thấy bảng' }, { action: 'Bấm lọc', expected: 'Lọc đúng' },
    ]);
  });
  it('splitSteps chịu được thiếu expected và dòng trống', () => {
    expect(splitSteps('Bước 1\n\nBước 2', '1) OK')).toEqual([{ action: 'Bước 1', expected: 'OK' }, { action: 'Bước 2', expected: '' }]);
    expect(splitSteps('', '')).toEqual([]);
  });
  it('formatCode theo mẫu CL_{mã function}-{seq 3 chữ số}', () => {
    expect(formatCode('NDS-U-00796', 20)).toBe('CL_NDS-U-00796-020');
    expect(formatCode('NDS-U-00796', 1234)).toBe('CL_NDS-U-00796-1234');
  });
  it('progress = (passed + failed) / total', () => {
    expect(progressOf({ total: 10, passed: 5, failed: 0, na: 0 })).toBe(50);
    expect(progressOf({ total: 10, passed: 4, failed: 1, na: 2 })).toBe(50);
    expect(progressOf({ total: 3, passed: 0, failed: 0, na: 3 })).toBe(0);
  });
});

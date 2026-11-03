import { fmtNumber, parseNumber } from './number';

it('uses Vietnamese grouping and decimal separators', () => {
  expect(fmtNumber(1234567.89)).toBe('1.234.567,89');
  expect(fmtNumber(-1234.5)).toBe('-1.234,5');
  expect(fmtNumber(0)).toBe('0');
  expect(fmtNumber(1234567890123456789n)).toBe('1.234.567.890.123.456.789');
  expect(fmtNumber(1.2, { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe('1,20');
  expect(fmtNumber(null)).toBe('—');
  expect(fmtNumber(NaN)).toBe('—');
});

it('parses displayed input back into raw numbers and rejects malformed input', () => {
  expect(parseNumber('1.234.567,89')).toBe(1234567.89);
  expect(parseNumber('1234,5')).toBe(1234.5);
  expect(parseNumber('-1.234')).toBe(-1234);
  expect(parseNumber('0')).toBe(0);
  for (const invalid of ['', '1..234', '12.34', '1,2,3', 'NaN']) expect(parseNumber(invalid)).toBeNaN();
});

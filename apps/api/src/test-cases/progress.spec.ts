import { progressOf } from './requirements.service';

describe('test execution progress', () => {
  it('counts passed and failed cases against the full total, including blocked and N/A', () => {
    expect(progressOf({ total: 250, passed: 75, failed: 25, na: 50 })).toBe(40);
  });
  it('handles no execution, empty functions and one-decimal percentages', () => {
    expect(progressOf({ total: 0, passed: 0, failed: 0, na: 0 })).toBe(0);
    expect(progressOf({ total: 10, passed: 0, failed: 0, na: 5 })).toBe(0);
    expect(progressOf({ total: 3, passed: 0, failed: 1, na: 0 })).toBe(33.3);
    expect(progressOf({ total: 10, passed: 4, failed: 6, na: 0 })).toBe(100);
  });
});

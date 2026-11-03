import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRoleDto, UpdateRoleDto } from './roles.dto';

describe('Role permission input validation', () => {
  const valid = { key: 'qc', name: 'QC', permissions: ['testcase.view'] };

  it('trims names and keys', async () => {
    const dto = plainToInstance(CreateRoleDto, { ...valid, key: ' qc ', name: ' QC ' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.key).toBe('qc');
    expect(dto.name).toBe('QC');
  });

  it.each([{ permissions: ['*'] }, { permissions: ['unknown.permission'] }, { permissions: ['testcase.view', 'testcase.view'] }, { permissions: null }, { permissions: 'testcase.view' }])(
    'rejects invalid permission input %j', async ({ permissions }) => {
      expect((await validate(plainToInstance(CreateRoleDto, { ...valid, permissions }))).length).toBeGreaterThan(0);
    },
  );

  it.each([{ key: ' ' }, { name: ' ' }, { key: 'QC!' }, { permissions: null }])('rejects invalid patch %j', async (input) => {
    expect((await validate(plainToInstance(UpdateRoleDto, input))).length).toBeGreaterThan(0);
  });
});

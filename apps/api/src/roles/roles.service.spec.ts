import { PrismaService } from '../common/prisma.service';
import { RolesService } from './roles.service';

describe('RolesService', () => {
  it('persists transitive prerequisites when creating a role', async () => {
    const tx = {
      roleDefinition: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 1n, description: null, ...data })),
      },
    };
    const prisma = { $transaction: jest.fn().mockImplementation((callback) => callback(tx)) };
    const service = new RolesService(prisma as unknown as PrismaService);
    const result = await service.create({ key: 'qc', name: 'QC', permissions: ['report.issue.create'] });
    expect(result.permissions).toEqual(expect.arrayContaining(['project.view', 'issue.view', 'issue.create', 'report.view', 'report.issue.create']));
    expect(tx.roleDefinition.create.mock.calls[0][0].data.permissions).toEqual(result.permissions);
  });

  it('rejects deletion when historical membership references a role', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      projectMember: { count: jest.fn().mockResolvedValue(1) },
      roleDefinition: { delete: jest.fn() },
    };
    const prisma = { $transaction: jest.fn().mockImplementation((callback) => callback(tx)) };
    await expect(new RolesService(prisma as unknown as PrismaService).remove(1n)).rejects.toMatchObject({ code: 'ROLE_IN_USE' });
    expect(tx.projectMember.count).toHaveBeenCalledWith({ where: { roleId: 1n } });
    expect(tx.roleDefinition.delete).not.toHaveBeenCalled();
  });
});

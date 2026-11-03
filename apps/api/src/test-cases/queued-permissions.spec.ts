import { ProjectContextService } from '../common/project-context.service';
import { PrismaService } from '../common/prisma.service';
import { ExcelService } from './excel.service';
import { RequirementsService } from './requirements.service';

describe('Queued test case authorization', () => {
  it('rejects an export when its user has been deactivated before execution', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ isActive: false }) } };
    const context = { requirePermission: jest.fn() };
    const service = new ExcelService(prisma as unknown as PrismaService, undefined!, undefined!, undefined!, context as unknown as ProjectContextService);
    await expect(service.runExport({ projectId: '1', userId: '2' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(context.requirePermission).not.toHaveBeenCalled();
  });

  it('checks current import access before reading or parsing the uploaded file', async () => {
    const user = { id: 2n, isActive: true, systemRole: 'member' };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) }, project: { findFirst: jest.fn().mockResolvedValue({ id: 1n }) } };
    const storage = { getObject: jest.fn() };
    const context = { requirePermission: jest.fn().mockRejectedValue(new Error('permission revoked')) };
    const service = new ExcelService(prisma as unknown as PrismaService, storage as never, undefined!, undefined!, context as unknown as ProjectContextService);
    await expect(service.runImport({ projectId: '1', userId: '2', objectKey: 'upload.xlsx', mode: 'commit' })).rejects.toThrow('permission revoked');
    expect(context.requirePermission).toHaveBeenCalledWith(user, 1n, 'testcase.import');
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('blocks function cascade deletion without test case delete permission', async () => {
    const tx = {
      requirement: { findFirst: jest.fn().mockResolvedValue({ id: 1n, kind: 'function' }), update: jest.fn() },
      issueFunction: { count: jest.fn().mockResolvedValue(0) },
      testCase: { count: jest.fn().mockResolvedValue(1), updateMany: jest.fn() },
    };
    const prisma = { $transaction: jest.fn().mockImplementation((callback) => callback(tx)) };
    const service = new RequirementsService(prisma as unknown as PrismaService, undefined!, undefined!);
    await expect(service.remove(1n, 2n, ['requirement.delete'])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(tx.requirement.update).not.toHaveBeenCalled();
    expect(tx.testCase.updateMany).not.toHaveBeenCalled();
  });
});

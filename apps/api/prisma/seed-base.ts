import { PrismaClient } from '@prisma/client';
import { normalizePermissions, WORKFLOW_TEMPLATES } from '@ospm/shared';
import * as argon2 from 'argon2';

/** Seed tối thiểu: 3 workflow template + system admin. Idempotent. */
export async function seedBase(prisma: PrismaClient) {
  await prisma.roleDefinition.upsert({ where: { key: 'qc' }, update: {}, create: { key: 'qc', name: 'QC', description: 'Xem thông tin dự án, Backlog, Active và Test cases.', permissions: normalizePermissions(['dashboard.view', 'project.info.view', 'project.backlog.view', 'project.board.view', 'testcase.view']) } });
  for (const [name, definition] of Object.entries(WORKFLOW_TEMPLATES)) {
    await prisma.workflowTemplate.upsert({ where: { name }, update: { definition: definition as any }, create: { name, definition: definition as any } });
  }
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
  await prisma.user.upsert({
    where: { email: 'admin@local.test' },
    update: {},
    create: { email: 'admin@local.test', displayName: 'System Admin', systemRole: 'admin', passwordHash: await argon2.hash(password) },
  });
}

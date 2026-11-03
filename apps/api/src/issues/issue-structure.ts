import { ERROR_CODES } from '@ospm/shared';
import { Tx } from '../common/prisma.service';
import { unprocessable } from '../common/errors';

export async function syncIssueStructure(tx: Tx, issueId: bigint, projectId: bigint, moduleIds?: number[], functionIds?: number[]) {
  if (moduleIds === undefined && functionIds === undefined) return;
  const item = await tx.issue.findUniqueOrThrow({ where: { id: issueId }, include: { epicRequirement: { include: { epicLinks: { where: { function: { deletedAt: null } } }, modules: true } }, functions: true, modules: true } });
  const epic = item.type === 'epic' ? item.epicRequirement : null;
  const wantedFunctions = functionIds === undefined
    ? [...new Set([...item.functions.map(f => f.functionId), ...(epic?.epicLinks.map(f => f.functionId) ?? [])])]
    : [...new Set(functionIds.map(BigInt))];
  const functions = await tx.requirement.findMany({ where: { id: { in: wantedFunctions }, projectId, kind: 'function', deletedAt: null } });
  if (functions.length !== wantedFunctions.length) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Function phải còn hoạt động và thuộc dự án này');
  const explicitModules = new Set(moduleIds === undefined
    ? [...item.modules.map(m => m.moduleId), ...(epic?.modules.map(m => m.moduleId) ?? [])]
    : moduleIds.map(BigInt));
  const wantedModules = new Set(explicitModules);
  for (const fn of functions) if (fn.moduleId) wantedModules.add(fn.moduleId);
  const modules = await tx.projectModule.findMany({ where: { id: { in: [...wantedModules] }, projectId, deletedAt: null } });
  if (modules.length !== wantedModules.size) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Module phải còn hoạt động và thuộc dự án này');
  await tx.issueFunction.deleteMany({ where: { issueId } });
  await tx.issueModule.deleteMany({ where: { issueId } });
  if(epic) {
    await tx.requirementLink.deleteMany({ where: { epicId: epic.id } });
    await tx.epicModule.deleteMany({ where: { epicId: epic.id } });
    if(functions.length) await tx.requirementLink.createMany({ data: functions.map(f => ({ epicId: epic.id, functionId: f.id })) });
    if(explicitModules.size) await tx.epicModule.createMany({ data: [...explicitModules].map(moduleId => ({ epicId: epic.id, moduleId })) });
    return;
  }
  if (functions.length) await tx.issueFunction.createMany({ data: functions.map(f => ({ issueId, functionId: f.id })) });
  if (explicitModules.size) await tx.issueModule.createMany({ data: [...explicitModules].map(moduleId => ({ issueId, moduleId })) });
}

export async function guardEpicDeletion(tx: Tx, issueId: bigint) {
  const req = await tx.requirement.findUnique({ where: { epicIssueId: issueId } });
  if (await tx.issueModule.count({ where: { issueId } }) || await tx.issueFunction.count({ where: { issueId } }) || await tx.issue.count({ where: { parentId: issueId, deletedAt: null } }) ||
      (req && (await tx.requirementLink.count({ where: { epicId: req.id, function: { deletedAt: null } } }) || await tx.epicModule.count({ where: { epicId: req.id } })))) {
    throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Cần gỡ liên kết item, Function và Module trước khi xóa Epic');
  }
}

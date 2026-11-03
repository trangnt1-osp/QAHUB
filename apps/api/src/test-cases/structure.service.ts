import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@ospm/shared';
import { PrismaService } from '../common/prisma.service';
import { AppException, notFound, unprocessable } from '../common/errors';

@Injectable()
export class StructureService {
  constructor(private readonly prisma: PrismaService) {}
  async options(projectId: bigint) {
    const [modules, requirements, assignments] = await Promise.all([
      this.prisma.projectModule.findMany({ where: { projectId, deletedAt: null }, orderBy: [{ code: 'asc' }, { id: 'asc' }] }),
      this.prisma.requirement.findMany({ where: { projectId, deletedAt: null }, include: { epicIssue: true, epicLinks: true, functionLinks: true, modules: true }, orderBy: [{ rank: 'asc' }, { id: 'asc' }] }),
      this.prisma.issue.findMany({ where: { projectId, deletedAt: null }, select: { id: true, parentId: true, functions: true, modules: true } }),
    ]);
    const functions = requirements.filter(r => r.kind === 'function');
    const functionIdsActive = new Set(functions.map(f => f.id));
    const epicIdsActive = new Set(requirements.filter(r => r.kind === 'epic' && r.epicIssue && !r.epicIssue.deletedAt).map(e => e.id));
    const epics = requirements.filter(r => r.kind === 'epic' && r.epicIssue && !r.epicIssue.deletedAt).map(r => {
      const itemIds = new Set([r.epicIssueId!]);
      for (let depth=0; depth<2; depth++) for (const i of assignments) if(i.parentId && itemIds.has(i.parentId)) itemIds.add(i.id);
      const functionIds = new Set(r.epicLinks.filter(l => functionIdsActive.has(l.functionId)).map(l => l.functionId));
      const moduleIds = new Set(r.modules.map(m => m.moduleId));
      for(const i of assignments) if(itemIds.has(i.id)) { for(const f of i.functions) functionIds.add(f.functionId); for(const m of i.modules) moduleIds.add(m.moduleId); }
      for(const f of functions) if(functionIds.has(f.id) && f.moduleId) moduleIds.add(f.moduleId);
      return { id: r.epicIssueId!, requirementId: r.id, key: '', code: r.code, name: r.name, moduleIds: [...moduleIds], functionIds: [...functionIds], explicitModuleIds: r.modules.map(m => m.moduleId), explicitFunctionIds: r.epicLinks.filter(l => functionIdsActive.has(l.functionId)).map(l => l.functionId), version: r.epicIssue!.version, number: r.epicIssue!.number };
    });
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { key: true } });
    return { modules: modules.map(m => ({ id: m.id, code: m.code, name: m.name, description: m.description })), functions: functions.map(f => ({ id: f.id, code: f.code, name: f.name, moduleId: f.moduleId, explicitEpicIds: f.functionLinks.filter(l => epicIdsActive.has(l.epicId)).map(l => l.epicId), epicIds: epics.filter(e => e.functionIds.includes(f.id)).map(e => e.requirementId) })), epics: epics.map(({ number, ...e }) => ({ ...e, key: `${project.key}-${number}` })) };
  }
  async saveModule(projectId: bigint, dto: { code?: string; name?: string; description?: string | null }, id?: bigint) {
    return this.prisma.$transaction(async tx => {
      if(id && !await tx.projectModule.findFirst({ where: { id, projectId, deletedAt: null } })) throw notFound(ERROR_CODES.NOT_FOUND, 'Không tìm thấy Module');
      const code=dto.code?.trim(), name=dto.name?.trim();
      if(code === '' || name === '') throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Cần nhập mã và tên');
      if(code && await tx.projectModule.findFirst({ where: { projectId, code, ...(id ? { id: { not: id } } : {}) } })) throw new AppException(409, 'MODULE_CODE_TAKEN', 'Mã Module đã tồn tại');
      return id ? tx.projectModule.update({ where: { id }, data: { code, name, description: dto.description } }) : tx.projectModule.create({ data: { projectId, code: code!, name: name!, description: dto.description } });
    });
  }
  async removeModule(projectId: bigint, id: bigint) {
    await this.prisma.$transaction(async tx => {
      if(!await tx.projectModule.findFirst({ where: { id, projectId, deletedAt: null } })) throw notFound(ERROR_CODES.NOT_FOUND, 'Không tìm thấy Module');
      if(await tx.requirement.count({ where: { moduleId: id, deletedAt: null } }) || await tx.issueModule.count({ where: { moduleId: id, issue: { deletedAt: null } } }) || await tx.epicModule.count({ where: { moduleId: id, epic: { deletedAt: null } } })) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Module còn liên kết Function, Epic hoặc item');
      await tx.projectModule.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }
}

import type { Permission } from '@ospm/shared';

/** Explicit endpoint policy: custom roles never inherit a numeric role rank. */
export const ENDPOINT_PERMISSIONS: Record<string, Permission | Permission[]> = {
  'ProjectsController.getProject': 'project.view',
  'ProjectsController.updateProject': 'project.info.edit',
  'ProjectsController.deleteProject': 'project.info.edit',
  'ProjectsController.updateProjectSettings': 'settings.general.edit',
  'ProjectsController.listProjectMembers': 'project.members.view',
  'ProjectsController.addProjectMember': 'project.members.create',
  'ProjectsController.updateProjectMember': 'project.members.edit',
  'ProjectsController.removeProjectMember': 'project.members.delete',
  'ProjectsController.leaveProjectMember': 'project.members.delete',
  'BoardsController.getBacklog': 'project.backlog.view',
  'BoardsController.getBoard': 'project.board.view',
  'SummaryController.getSummary': 'project.summary.view',
  'SummaryController.getBugContributors': 'project.summary.view',
  'SummaryController.getProjectActivity': 'project.summary.view',
  'IssuesController.listIssues': 'issue.view',
  'IssuesController.getIssue': 'issue.view',
  'IssuesController.createIssue': 'issue.create',
  'IssuesController.updateIssue': 'issue.edit',
  'IssuesController.bulkUpdateIssues': ['issue.edit', 'issue.delete', 'issue.transition'],
  'IssuesController.transitionIssue': 'issue.transition',
  'IssuesController.triageIssue': 'issue.triage',
  'IssuesController.rankIssue': 'issue.edit',
  'IssuesController.deleteIssue': 'issue.delete',
  'IssuesController.listComments': 'issue.view',
  'IssuesController.addComment': 'issue.comment',
  'IssuesController.updateComment': 'issue.comment',
  'IssuesController.deleteComment': 'issue.comment',
  'IssuesController.addIssueLink': 'issue.links.edit',
  'IssuesController.removeIssueLink': 'issue.links.edit',
  'IssuesController.getIssueActivity': 'issue.view',
  'IssuesController.listLabels': ['issue.view', 'testcase.view', 'settings.labels.view'],
  'IssuesController.createLabel': ['issue.edit', 'settings.labels.edit'],
  'IssuesController.updateLabel': 'settings.labels.edit',
  'IssuesController.deleteLabel': 'settings.labels.edit',
  'SprintsController.listSprints': 'period.view',
  'SprintsController.createSprint': 'period.create',
  'SprintsController.updateSprint': 'period.edit',
  'SprintsController.startSprint': 'period.start',
  'SprintsController.completeSprint': 'period.complete',
  'SprintsController.deleteSprint': 'period.delete',
  'WorkflowsController.getWorkflow': 'settings.workflow.view',
  'WorkflowsController.saveWorkflow': 'settings.workflow.edit',
  'WorkflowsController.applyWorkflowTemplate': 'settings.workflow.edit',
  'ApiKeysController.listApiKeys': 'apikey.view',
  'ApiKeysController.createApiKey': 'apikey.manage',
  'ApiKeysController.revokeApiKey': 'apikey.manage',
  'AutomationController.listAutomationRuns': 'report.view',
  'AutomationController.getAutomationRun': 'report.view',
  'AutomationController.listAutomationResults': 'report.view',
  'AutomationController.getAutomationResult': 'report.view',
  'AutomationController.createIssueFromResult': 'report.issue.create',
  'AttachmentsController.completeAttachment': 'attachment.create',
  'AttachmentsController.getAttachmentUrl': 'attachment.view',
  'TestCasesController.listRequirements': 'testcase.view',
  'TestCasesController.createRequirement': 'requirement.create',
  'TestCasesController.updateRequirement': 'requirement.edit',
  'TestCasesController.deleteRequirement': 'requirement.delete',
  'TestCasesController.listTestCategories': ['testcase.view', 'settings.general.view'],
  'TestCasesController.createTestCategory': ['settings.general.edit', 'testcase.category.manage'],
  'TestCasesController.updateTestCategory': ['settings.general.edit', 'testcase.category.manage'],
  'TestCasesController.deleteTestCategory': ['settings.general.edit', 'testcase.category.manage'],
  'TestCasesController.listTestCases': 'testcase.view',
  'TestCasesController.listTestCaseIds': 'testcase.view',
  'TestCasesController.getTestCaseSummary': 'testcase.view',
  'TestCasesController.createTestCase': 'testcase.create',
  'TestCasesController.bulkUpdateTestCases': ['testcase.edit', 'testcase.delete'],
  'TestCasesController.getTestCase': 'testcase.view',
  'TestCasesController.updateTestCase': 'testcase.edit',
  'TestCasesController.deleteTestCase': 'testcase.delete',
  'TestCasesController.moveTestCase': 'testcase.edit',
  'TestCasesController.linkTestCaseBug': 'testcase.bug.link',
  'TestCasesController.unlinkTestCaseBug': 'testcase.bug.link',
  'TestCasesController.importTestCases': 'testcase.import',
  'TestCasesController.commitImport': 'testcase.import',
  'TestCasesController.exportTestCases': 'testcase.export',
};

export function mutationPermissions(endpoint: string, body: unknown): Permission[] {
  if (['TestCasesController.createRequirement', 'TestCasesController.updateRequirement', 'TestCasesController.deleteRequirement', 'StructureController.create', 'StructureController.update', 'StructureController.remove'].includes(endpoint)) return ['project.structure.view'];
  const payload = body as { set?: Record<string, unknown> } | undefined;
  const set = payload?.set ?? {};
  if (endpoint === 'IssuesController.bulkUpdateIssues') {
    if (set.deleted) return ['issue.delete'];
    return [...(set.statusId ? ['issue.transition' as const] : []), ...(Object.keys(set).some((key) => key !== 'statusId' && key !== 'deleted') ? ['issue.edit' as const] : [])];
  }
  if (endpoint === 'TestCasesController.bulkUpdateTestCases') return [set.deleted ? 'testcase.delete' : 'testcase.edit'];
  if (endpoint === 'TestCasesController.linkTestCaseBug' && (body as { createBug?: boolean } | undefined)?.createBug) return ['issue.create', 'testcase.edit'];
  return [];
}

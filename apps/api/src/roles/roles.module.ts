import { Module } from '@nestjs/common';
import { ProjectRoleOptionsController, RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({ controllers: [RolesController, ProjectRoleOptionsController], providers: [RolesService], exports: [RolesService] })
export class RolesModule {}

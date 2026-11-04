import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { EnvironmentsController } from './environments.controller';
import { EnvironmentsService } from './environments.service';
import { MasterplanController } from './masterplan.controller';
import { MasterplanService } from './masterplan.service';

@Module({ controllers: [ProjectsController, EnvironmentsController, MasterplanController], providers: [ProjectsService, EnvironmentsService, MasterplanService], exports: [ProjectsService] })
export class ProjectsModule {}

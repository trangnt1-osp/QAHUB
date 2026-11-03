import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { EnvironmentsController } from './environments.controller';
import { EnvironmentsService } from './environments.service';

@Module({ controllers: [ProjectsController, EnvironmentsController], providers: [ProjectsService, EnvironmentsService], exports: [ProjectsService] })
export class ProjectsModule {}

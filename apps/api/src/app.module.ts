import { Module } from '@nestjs/common';
import { Infrastructure } from './infrastructure';
import { HealthController } from './health.controller';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { AdminController } from './admin/admin.controller';
import { ProjectsService } from './work/projects.service';
import { TasksService } from './work/tasks.service';
import { WorkController } from './work/work.controller';

@Module({ providers: [Infrastructure, AuthService, ProjectsService, TasksService], controllers: [HealthController, AuthController, AdminController, WorkController] })
export class AppModule {}

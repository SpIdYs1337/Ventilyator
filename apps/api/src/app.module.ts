import { Module } from '@nestjs/common';
import { Infrastructure } from './infrastructure';
import { HealthController } from './health.controller';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { AdminController } from './admin/admin.controller';
import { ProjectsService } from './work/projects.service';
import { TasksService } from './work/tasks.service';
import { WorkController } from './work/work.controller';
import { KnowledgeService } from './knowledge/knowledge.service';
import { KnowledgeController } from './knowledge/knowledge.controller';
import { PlanningService } from './work/planning.service';
import { PlanningController } from './work/planning.controller';
import { FilesService } from './files/files.service';
import { FilesController } from './files/files.controller';
import { PortalService } from './portal/portal.service';
import { PortalController } from './portal/portal.controller';
import { MailService } from './admin/mail.service';
import { MailController } from './admin/mail.controller';
import { UsersService } from './admin/users.service';
import { UsersController } from './admin/users.controller';
import { RolesController } from './admin/roles.controller';

@Module({ providers: [Infrastructure, AuthService, ProjectsService, TasksService, KnowledgeService, PlanningService, FilesService, PortalService, MailService, UsersService], controllers: [HealthController, AuthController, AdminController, WorkController, KnowledgeController, PlanningController, FilesController, PortalController, MailController, UsersController, RolesController] })
export class AppModule {}

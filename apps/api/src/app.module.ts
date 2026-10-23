import { Module } from '@nestjs/common';
import { Infrastructure } from './infrastructure';
import { HealthController } from './health.controller';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { AdminController } from './admin/admin.controller';

@Module({ providers: [Infrastructure, AuthService], controllers: [HealthController, AuthController, AdminController] })
export class AppModule {}

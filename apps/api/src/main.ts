import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { Infrastructure } from './infrastructure';
import { DatabaseErrorFilter } from './database-error.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  const infra = app.get(Infrastructure);
  // API has no published port; only one reverse proxy is trusted.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new DatabaseErrorFilter());
  app.use(helmet());
  app.use(cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (req.get('origin') !== infra.config.APP_ORIGIN || req.get('x-ventilyator-request') !== '1')) {
      res.status(403).json({ message: 'Проверка CSRF не пройдена' }); return;
    }
    next();
  });
  if (infra.config.NODE_ENV !== 'production') {
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Ventilyator API').setVersion('0.1.0').addCookieAuth('ventilyator_session').build()));
  }
  await infra.initializeStorage();
  await infra.db.$connect();
  app.enableShutdownHooks();
  await app.listen(infra.config.PORT, '0.0.0.0');
}
bootstrap().catch(() => { console.error('Ventilyator API initialization failed. Check database, storage permissions and configuration.'); process.exitCode = 1; });

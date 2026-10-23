import { Catch, type ExceptionFilter, type ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@ventilyator/database';
import type { Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError)
export class DatabaseErrorFilter implements ExceptionFilter {
  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error.code === 'P2002') { res.status(409).json({ message: 'Запись с такими уникальными данными уже существует' }); return; }
    if (error.code === 'P2025') { res.status(404).json({ message: 'Запись не найдена' }); return; }
    // Do not serialize database query parameters or connection details into logs/responses.
    console.error('Ventilyator database operation failed:', error.code);
    res.status(500).json({ message: 'Не удалось выполнить операцию с базой данных' });
  }
}

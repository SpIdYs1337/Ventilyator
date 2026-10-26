import { BadRequestException } from '@nestjs/common';
export function input<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('Проверьте поля запроса');
  return parsed.data;
}

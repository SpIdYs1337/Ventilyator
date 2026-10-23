import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';

test('local administrator creates a user in the web UI, and sessions can be revoked', async ({ page }) => {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_FILE) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD_FILE must reference a development bootstrap account');
  const password = readFileSync(process.env.ADMIN_PASSWORD_FILE, 'utf8').trim();
  const email = `e2e-${randomUUID()}@example.org`;
  const memberPassword = randomBytes(24).toString('base64url');
  await page.goto('/');
  await page.getByLabel('Рабочая почта').fill(process.env.ADMIN_EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
  await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'PostgreSQL' })).toBeVisible();
  await page.getByRole('tab', { name: 'Пользователи' }).click();
  await page.getByRole('button', { name: 'Добавить сотрудника' }).click();
  await page.getByLabel('Имя', { exact: true }).fill('Пользователь E2E');
  await page.getByLabel('Почта', { exact: true }).fill(email);
  await page.getByLabel('Начальный пароль').fill(memberPassword);
  await page.getByLabel('Роль', { exact: true }).selectOption({ label: 'Team Member' });
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('cell', { name: email, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Вход в Ventilyator' })).toBeVisible();
  await page.getByLabel('Рабочая почта').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(memberPassword);
  await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
  await expect(page.getByText('Здравствуйте, Пользователь E2E.', { exact: false })).toBeVisible();
  await page.goto('/sessions');
  await expect(page.getByText('Это устройство', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Завершить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Вход в Ventilyator' })).toBeVisible();
});

test('unauthenticated visitor cannot open an administrative screen', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Вход в Ventilyator' })).toBeVisible();
});

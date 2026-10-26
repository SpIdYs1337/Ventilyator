import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

async function login(page: Page) {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_FILE) throw new Error('Development administrator required');
  await page.goto('/');
  await page.getByLabel('Рабочая почта').fill(process.env.ADMIN_EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(readFileSync(process.env.ADMIN_PASSWORD_FILE, 'utf8').trim());
  await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
  await expect(page.getByRole('heading', { name: 'Рабочий стол', exact: true })).toBeVisible();
}

test('compact layout changes dimensions, keeps navigation accessible and survives reload', async ({ page }, info) => {
  await login(page);
  const toggle = page.getByRole('button', { name: 'Компактный режим', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const padding = await page.locator('.content').evaluate(element => parseFloat(getComputedStyle(element).paddingTop));
  const sidebar = page.locator('#workspace-sidebar');
  const width = info.project.name === 'mobile' ? null : (await sidebar.boundingBox())!.width;
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('.content').evaluate(element => parseFloat(getComputedStyle(element).paddingTop))).toBeLessThan(padding);
  if (width) await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(width);
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  const projects = sidebar.getByRole('link', { name: 'Проекты и задачи', exact: true });
  await expect(projects).toBeVisible();
  await projects.click();
  await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  if (width) await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(width);
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('mail settings open before configuration and IMAP can be saved through the UI', async ({ page }) => {
  await login(page);
  await page.goto('/admin');
  const loaded = page.waitForResponse(response => response.url().endsWith('/api/admin/mail') && response.request().method() === 'GET');
  await page.getByRole('tab', { name: 'Почта и IMAP', exact: true }).click();
  const response = await loaded;
  expect(response.status()).toBe(200);
  const initial = await response.json();
  await expect(page.getByRole('heading', { name: 'Корпоративный вход IMAP', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('IMAP-сервер', { exact: true })).toHaveValue(initial.imapHost);
  const domain = `imap-${randomUUID().slice(0, 8)}.example.org`;
  await page.getByLabel('Включить IMAP-вход', { exact: true }).check();
  await page.getByLabel('IMAP-сервер', { exact: true }).fill(`mail.${domain}`);
  await page.getByLabel('Разрешённый домен', { exact: true }).fill(domain);
  await page.getByRole('button', { name: 'Сохранить почтовые настройки', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Настройки сохранены.');
  await page.reload();
  await page.getByRole('tab', { name: 'Почта и IMAP', exact: true }).click();
  await expect(page.getByLabel('Включить IMAP-вход', { exact: true })).toBeChecked();
  await expect(page.getByLabel('IMAP-сервер', { exact: true })).toHaveValue(`mail.${domain}`);
  await expect(page.getByLabel('Разрешённый домен', { exact: true })).toHaveValue(domain);
  await expect(page.getByRole('alert')).toHaveCount(0);
  // Do not connect to any external mail host: TLS/IMAP protocol tests use local fixtures.
  await page.getByLabel('Включить IMAP-вход', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Сохранить почтовые настройки', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Настройки сохранены.');
});

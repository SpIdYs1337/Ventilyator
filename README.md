# Ventilyator

Автономная корпоративная платформа для внутренней сети организации. Данные PostgreSQL, Redis и файлового хранилища находятся на собственном сервере. Обязательных облачных сервисов нет.

**Текущее состояние:** локальные пользователи, проекты с участниками и правами, задачи, список и доска, комментарии и история изменений. Это промежуточный рабочий этап, ещё не полная платформа из задания. База знаний, вложения, настраиваемые процессы, SMTP и веб-настройки IMAP пока не реализованы. Результаты проверок — в [DEVELOPMENT.md](DEVELOPMENT.md); оставшиеся этапы — в [ROADMAP.md](ROADMAP.md).

Работа с проектами и обновление существующего сервера: [docs/projects-tasks.md](docs/projects-tasks.md).

## Локальные пользователи обязательны

Первый администратор создаётся отдельной одноразовой командой. Остальных локальных пользователей администратор создаёт через веб-интерфейс «Администрирование → Пользователи → Добавить сотрудника». Локальный вход не зависит от почтового сервера. IMAP и уведомления — дополнительные, отдельно включаемые возможности; требование их реализации сохраняется в дорожной карте.

## Стек

pnpm workspaces, Node.js 24 LTS, TypeScript strict, React, Vite, Tailwind, Radix/shadcn-style UI, TanStack Query, Zustand, React Hook Form, Zod; NestJS, Prisma 7 + PostgreSQL adapter, PostgreSQL 18, Redis 8, BullMQ; Caddy. Версии пакетов зафиксированы в `pnpm-lock.yaml`, базовые образы — по digest. TypeScript 6 выбран для совместимости с NestJS Swagger; предварительные версии не используются.

## Запуск на Ubuntu

Подробная инструкция: [INSTALLATION.md](INSTALLATION.md).

```bash
git clone --branch main --single-branch https://github.com/SpIdYs1337/Ventilyator.git
cd Ventilyator
python3 infrastructure/scripts/configure.py --host ventilyator.company.local
sudo sh infrastructure/scripts/prepare-host.sh /srv/ventilyator
docker compose up -d --build
docker compose ps
```

Далее создайте первого администратора по инструкции. В системе нет заранее известного пароля и автоматического демо-пользователя.

Для уже установленного тестового сервера доступ по IP без настройки компьютера с браузером:

```bash
git pull --ff-only origin main
python3 infrastructure/scripts/configure-lan.py 192.168.1.50
docker compose up -d --no-build --wait --wait-timeout 180
```

Замените IP адресом сервера и откройте `http://192.168.1.50`. Существующие пользователи и данные сохраняются. HTTP передаёт пароль без шифрования; этот режим предназначен только для изолированной тестовой сети. Подробности — в начале [INSTALLATION.md](INSTALLATION.md).

Для изолированной HTTP-проверки разработчика:

```bash
python3 infrastructure/scripts/configure.py --development --data-root "$(pwd)/.local/data"
sudo sh infrastructure/scripts/prepare-host.sh "$(pwd)/.local/data"
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

`.env` не перезаписывается; повторно генерировать его поверх работающей установки нельзя. HTTP-override публикует порт только на loopback.

## Структура

`apps/web` — интерфейс; `apps/api` — модульный backend; `apps/worker` — отдельный обработчик; `packages/database` — Prisma и миграции; `packages/shared`, `validation`, `config`, `ui` — общие пакеты; `infrastructure` — Compose, Caddy и скрипты; `tests` — модульные, интеграционные и браузерные проверки.

## Документация

[Архитектура](ARCHITECTURE.md) · [Конфигурация](CONFIGURATION.md) · [Безопасность](SECURITY.md) · [База данных](DATABASE.md) · [Хранилище](STORAGE.md) · [API](API.md) · [Разработка](DEVELOPMENT.md) · [Эксплуатация](OPERATIONS.md) · [Резервные копии](BACKUP_RESTORE.md) · [Исходное задание](docs/requirements.md).

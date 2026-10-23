# Разработка и проверки

Используйте существующий checkout: каждая облачная задача уже изолирована. Не создавайте worktree без явного запроса пользователя.

Нужны Node 24 LTS, pnpm 11.25.0, Docker Compose ≥2.24.4, Python 3. Все зависимости зафиксированы; TypeScript 6 согласован с peer constraints NestJS Swagger. Не обновляйте пакеты на prerelease для устранения ошибки установки.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
python3 -m unittest discover -s tests/unit -p 'test_*.py' -v
```

В облачной среде домашние каталоги read-only. Используйте `XDG_CACHE_HOME=/workspace/.cache`, `XDG_DATA_HOME=/workspace/.cache/data`, `XDG_STATE_HOME=/workspace/.cache/state`, `npm_config_cache=/workspace/.cache/npm`, `DOCKER_CONFIG=/workspace/.cache/docker`, `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright`. Для pnpm задайте `--store-dir /workspace/.cache/pnpm-store`.

Сборка под корпоративным прокси использует стандартные HTTP_PROXY/HTTPS_PROXY, build secret `corporate_ca` и разрешение имени прокси в Docker builder. Локальный `.local/cloud-build.yml` создаётся только для облачной машины, секретов не содержит, Git его игнорирует. Не отключайте проверку TLS или Prisma checksum. Требуемое дополнение allowlist: binaries.prisma.sh.

## Интеграция

После полного запуска development Compose:

```bash
docker compose exec -T ventilyator-api node tests/integration/smoke.cjs
docker compose exec -T ventilyator-api node tests/integration/work.cjs
```

Сценарий создаёт временные организации и случайные credentials, проверяет реальные PostgreSQL/Redis/API/BullMQ, CSRF, организационную изоляцию, административное создание пользователя, запрет повышения прав, отзыв сессии и аудит; затем удаляет свои данные. Запуск в NODE_ENV=production запрещён.

Второй сценарий проверяет проекты/задачи на настоящей PostgreSQL: ACL, составные FK, назначения, конкурентную выдачу номеров и сохранение, архив/восстановление, комментарии, историю и отзыв членства. Он также удаляет свои fixtures. Эти API-проверки не заменяют браузерный сценарий.

## Браузер

Создайте development-администратора по INSTALLATION.md, оставив его пароль в закрытом локальном файле на время тестов. Затем:

```bash
pnpm exec playwright install chromium
ADMIN_EMAIL=admin@company.local ADMIN_PASSWORD_FILE="$PWD/.local/admin-password" pnpm test:e2e
```

Если системный Chromium уже установлен, загрузка браузера из CDN не нужна:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  ADMIN_EMAIL=admin@company.local ADMIN_PASSWORD_FILE="$PWD/.local/admin-password" pnpm test:e2e
```

Проверки desktop и mobile создают пользователей через интерфейс и входят под ними. Сценарий work также создаёт проект, приглашает участника, назначает задачу, меняет статус, сохраняет описание, комментарий и проверяет историю. Используйте изолированную development-базу; созданные E2E-пользователи/проекты остаются в ней. Трассировка выключена, чтобы не сохранять пароли в HAR/trace. Тесты не создают фиктивных production-аккаунтов и не используют общий известный пароль.

## Дополнительные проверки

```bash
VENTILYATOR_TEST_ENV=development ADMIN_EMAIL=admin@ventilyator.local \
  ADMIN_PASSWORD_FILE="$PWD/.local/admin-password" python3 tests/integration/persistence.py
python3 tests/integration/tls.py
```

Первая проверка пересоздаёт development-контейнеры, проверяет сохранность пользователя, Redis-сессии и байтов storage, затем останавливает/запускает worker и проверяет readiness. Вторая запускает временный Caddy на loopback-порту 8443, проверяет отказ недоверенного CA и успешный HTTPS с доверенным CA. Нельзя запускать эти сценарии параллельно: persistence намеренно перезапускает стек.

Если Playwright CDN недоступен, предусмотрен `infrastructure/docker/e2e.Dockerfile` с Chromium из подписанных Debian-репозиториев. Соберите его после backend и используйте Linux `--network host`, чтобы browser origin оставался `http://localhost:8080`. Передайте закрытый файл пароля отдельным read-only mount; tests/config можно примонтировать read-only, а каталог test-results — отдельно writable. Переменная PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH поддерживает системный Chromium.

## Повторный запуск облачного снимка

```bash
bash infrastructure/scripts/cloud-install.sh
bash infrastructure/scripts/cloud-start.sh
```

Install повторно использует сохранённый проверенный pnpm store офлайн; если его нет, требуется сеть. Start запускает сохранённые Docker-образы и проверяет readiness/HTML. Если образы не сохранились, выполните обычную сборку:

```bash
python3 infrastructure/scripts/cloud-build.py
DOCKER_CONFIG=/workspace/.cache/docker docker compose \
  -f docker-compose.yml -f docker-compose.dev.yml -f .local/cloud-build.yml \
  build ventilyator-api ventilyator-web ventilyator-proxy
bash infrastructure/scripts/cloud-start.sh
```

Это не процедура обновления production. После изменения исходников необходимо пересобрать образы. `.local` содержит только локальные артефакты/конфигурацию и закрытый пароль development-администратора; не коммитьте его и не используйте такой bootstrap-пароль в production.

## Фактически выполнено в этой среде

| Проверка | Результат |
|---|---|
| Установка зависимостей и повторная offline-установка | Успешно, frozen lockfile и package integrity сохранены |
| Сборка всех 8 пакетов/apps | Успешно, включая Prisma Client, API, worker и web |
| TypeScript strict / ESLint | Успешно |
| Unit | 9 passed, 0 failed |
| Python / настройка LAN HTTP | 8 passed: сохранность конфигурации, закрытый backup, повторный запуск, адрес/порт и отказ от неподходящего .env |
| Compose config / полный запуск | Успешно, сервисы healthy, migrate exited 0 |
| PostgreSQL 18.1 / Redis 8.4 | Реальные SELECT / PONG |
| SQL и Prisma migrations | Применены; schema diff: No difference detected; повторный запуск идемпотентен |
| Интеграционные API/Identity/BullMQ | 16 passed; временные организации и пользователи удалены |
| Интеграционные проекты/задачи | 26 passed; ACL, FK, конкурентные номера/сохранение, комментарии/история, архив/восстановление, понижение роли и отзыв доступа; fixtures удалены |
| Bootstrap | Первый администратор создан с новым случайным паролем из закрытого файла |
| Caddy HTTP | HTML, JavaScript, CSS и API readiness возвращают 200 |
| LAN HTTP profile | Compose merge проверен; существующий администратор входит, читает профиль и выходит; HTTP-cookie работает, чужой Origin получает 403, Swagger закрыт (404) |
| Container recreation | PostgreSQL-пользователь, Redis-сессия и storage marker сохранились |
| Проекты после пересоздания API/worker | 2 созданных через браузер проекта и сохранённые описания задач доступны; существующий администратор входит |
| Worker failure/recovery | Liveness 200 / readiness 503 при остановке, readiness 200 после запуска |
| Caddy HTTPS | Недоверенный CA отклонён; trusted CA + hostname verification проходят |
| Browser E2E | 6 passed: Identity и проекты/задачи на desktop/mobile, системный Chromium 154 |
| IMAP с корпоративным сервером | Не выполнено: сервер не настроен; проверен отказ неявного связывания локальной учётной записи |
| SMTP, backup/restore | Ещё не реализованы |
| Отдельный Ubuntu Server | Не проверен |

Первоначальная чистая сборка Docker-образов успешна. После сетевых 503 приложение также пересобиралось с `--network=none` на ранее проверенных зависимостях; совпадение lockfile отдельно проверено. После восстановления сети успешно выполнена полная сборка текущего Dockerfile для backend/web/proxy, включая кешируемый слой зависимостей.

Для медленной сети в pnpm-workspace.yaml настроены networkConcurrency=8, fetchTimeout=180000, fetchRetries=3 и интервалы повторов 5–20 секунд. Все шесть параметров проверены через pnpm config get. BuildKit сохраняет отдельно store и metadata/cache pnpm; стандартные проверки TLS, lockfile, package integrity и supply-chain policies остаются включёнными. При повторной установке использованы все 539 пакетов из кеша без скачивания; команда pnpm сообщила 4,7 секунды. Это измерение тёплого кеша в данной среде, не обещание скорости первой сборки на другом сервере.

Контейнеры текущей машины проверены, восстановление в новой облачной задаче ещё не проверялось. Публикация версии облачной среды не выполнялась. Наличие кода в GitHub проверяется отдельно через git ls-remote.

Для текущего проектного среза выполнены обычные Docker-сборки backend/web, миграция существующей development-базы без удаления пользователей, повторный migrate deploy и Prisma schema diff без расхождений. Typecheck, lint, 9 TypeScript-unit, 8 Python-unit, 26 проектных и 16 прежних интеграционных проверок прошли. Браузерные тесты выполнились с `/usr/bin/chromium` 154.0.8037.57: 6 passed, desktop и mobile. Playwright CDN всё ещё возвращает 403; установленный системный браузер позволил выполнить сценарии. Во время нескольких пересборок заполнился 32 GB облачный диск; удалён неиспользуемый обычный build cache, данные и рабочие образы сохранены, стек после этого запущен и проверен. Это проверка данной облачной машины, не приёмка пользовательского Ubuntu-сервера.

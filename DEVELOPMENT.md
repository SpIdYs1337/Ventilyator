# Разработка и проверки

Нужны Node 24 LTS, pnpm 11.25.0, Python 3, Docker и Compose ≥2.24.4. Работайте в существующем checkout. Пакеты зафиксированы lockfile, prerelease не используются.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
python3 -m unittest discover -s tests/unit -p 'test_*.py'
```

В облачной среде используйте writable cache: XDG_CACHE_HOME=/workspace/.cache, XDG_DATA_HOME=/workspace/.cache/data, DOCKER_CONFIG=/workspace/.cache/docker, pnpm --store-dir /workspace/.cache/pnpm-store. BuildKit сохраняет store и metadata/cache отдельно. Proxy/доверенный CA поддерживаются через локальный cloud-build.py override. TLS, lockfile/integrity, supply-chain policies и Prisma checksum не отключаются. Нужен доступ к binaries.prisma.sh/registry/Docker Hub.

## Интеграционные проверки

Только изолированная development-установка, никогда production. Сценарии создают случайные временные данные; API-наборы удаляют свои организации. PostgreSQL/Redis/storage настоящие, ответы не подменяются.

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml
docker compose exec -T ventilyator-api node tests/integration/smoke.cjs
docker compose exec -T ventilyator-api node tests/integration/work.cjs
python3 tests/integration/migrations.py
python3 tests/integration/backup_restore.py
```

Migrations создаёт и удаляет отдельную временную базу, не меняя исходную. Backup/restore намеренно приостанавливает API/worker и запускает отдельный Compose project с пустыми данными/другими паролями/портом 18081. Не запускайте его параллельно API/E2E/persistence-тестам. Для override тестовой среды передайте VENTILYATOR_TEST_COMPOSE_FILES; по умолчанию base:dev.

## Почтовая интеграция и файлы

Набор platform.cjs поднимает локальные TLS SMTP, STARTTLS SMTP и IMAP fixtures. Сертификат выдаётся временным тестовым CA, hostname и TLS реально проверяются, worker действительно доставляет письмо на локальный fixture. Наружу почта не отправляется. API и worker должны видеть именно тестовый CA-файл; используйте только development override:

```bash
mkdir -p .local
cat > .local/mail-test.yml <<'YAML'
services:
  ventilyator-api:
    environment:
      MAIL_CA_FILE: /app/storage/.keys/platform-test-ca.pem
  ventilyator-worker:
    environment:
      MAIL_CA_FILE: /app/storage/.keys/platform-test-ca.pem
YAML
export COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml:.local/mail-test.yml
docker compose up -d --no-build --wait --wait-timeout 180
docker compose exec -T ventilyator-api node tests/integration/platform.cjs
```

Fixture создаёт/удаляет только временные тестовые сертификаты, SMTP-ключ приложения сохраняется. Проверяется ClamAV INSTREAM на локальном имитаторе: clean/found/недоступность обязательного сканера. Это проверка протокола, не антивирусной базы настоящего clamd.

После почтовых проверок вернитесь к обычному base:dev Compose. Настоящие корпоративные SMTP/IMAP/CA не использовались.

## Браузерные сценарии

На development-базе с отдельным администратором и закрытым файлом его пароля:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  ADMIN_EMAIL=admin@company.local \
  ADMIN_PASSWORD_FILE="$PWD/.local/admin-password" pnpm test:e2e
```

Можно установить браузер через `pnpm exec playwright install chromium`; здесь CDN отвечал403, поэтому использован системный Chromium154. Пароль не печатается и не передаётся argv. Trace/HAR выключены. Не запускайте набор многократно с одним email без учёта лимита 12 входов за 15 минут; защиту входа не отключайте. E2E-данные сохраняются в development-базе для проверки интерфейса, используйте отдельную тестовую организацию.

Desktop и Pixel7 emulation проходят локального пользователя/сессии, проект/приглашение/задачу/статус/историю, чек-лист/ручное время/таймер, личный черновик/публикацию/восстановление, файл с точными байтами, Markdown-таблицу/изображение/оглавление и повторное открытие. Мобильная проверка включает отсутствие горизонтального overflow документа. Это Chromium emulation, не испытание всех реальных iOS/Android устройств.

## Результаты этой работы

| Проверка | Результат |
|---|---|
| Frozen dependencies, Prisma Client, все 8 пакетов/apps | Сборка успешна |
| TypeScript strict / ESLint | Успешно |
| TypeScript unit | 19 passed: документы/XSS/структура/таблицы, Markdown, файловые границы и AES-GCM vault |
| Python unit | 12 passed: LAN-конфигурация и проверка backup/архивов |
| Identity/API/BullMQ | 16 passed |
| Проекты/задачи/ACL/конкурентные записи | 26 passed |
| Знания/planning/files/поиск/настройки/почта | 38 passed; в том числе worker SMTP TLS, STARTTLS verify, IMAP login/link/provision, дедупликация сроков и обязательный ClamAV-протокол |
| SQL migrations | 3 passed на отдельной свежей базе: цепочка, сохранение REVIEW/пользователя, backfill разрешения |
| Schema drift | No difference detected |
| Backup/restore | 4 passed: согласованная копия, отдельное восстановление с другими паролями БД/Redis, ключ SMTP, запрет перезаписи |
| Browser desktop/mobile | 8 passed; документы с таблицами/изображениями, задачи/время и пользователи |
| Полный deploy.sh | Выполнен: сборка → согласованный backup → migrate → запуск и healthchecks |
| Docker backend/web/proxy | Сборка и полный запуск успешны; API/worker/web/PG/Redis healthy, migrate Exited0 |
| Целевой чистый Ubuntu / корпоративная почта / настоящий ClamAV | Не проверены |

В ходе браузерных проверок исправлены проверка актуальных table align attrs Tiptap и мобильный фокус: DOM focus происходит до создания ProseMirror-транзакции, чтобы не отправлять устаревшую transaction. Чек-лист сохраняется асинхронно с оптимистичным отображением и откатом при ошибке. Реальные тесты повторяются после изменений, а не объявляются успешными по сборке.

Vite предупреждает о чанке редактора примерно993kB и основном чанке примерно519kB до gzip. Редактор вынесен из первоначальной загрузки по маршруту; дальнейшее уменьшение остаётся задачей оптимизации. Vitest предупреждает о будущем изменении configLoader для CommonJS-конфига; текущие тесты проходят. Нагрузочные испытания, аудит безопасности и полный паритет Jira/Confluence не выполнены.

Ранее в этой же среде проверены HTTPS Caddy с trusted CA/hostname, LAN cookie/CSRF/Swagger404, сохранность PostgreSQL/Redis/storage после пересоздания и readiness503 при остановленном worker с восстановлением200. Это не приёмка пользовательского Ubuntu. Публикация облачного снимка/восстановление в новой облачной задаче не выполнялись.

## Возобновление облачной development-среды

```bash
bash infrastructure/scripts/cloud-install.sh
bash infrastructure/scripts/cloud-start.sh
```

Для пересборки текущих исходников:

```bash
python3 infrastructure/scripts/cloud-build.py
DOCKER_CONFIG=/workspace/.cache/docker docker compose \
  -f docker-compose.yml -f docker-compose.dev.yml -f .local/cloud-build.yml \
  build ventilyator-api ventilyator-web ventilyator-proxy
bash infrastructure/scripts/cloud-start.sh
```

Не коммитьте .env, .local, пароли, backups и test-results. На маленьком облачном диске VFS build cache может занимать значительно больше места, чем размер образов; удаляйте только неиспользуемый обычный build cache, сохраняя данные и dependency cache. Production-update выполняется по DEPLOYMENT.md.

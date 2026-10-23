# PostgreSQL и Prisma

Схема: `packages/database/prisma/schema.prisma`. Первый SQL-файл: `packages/database/prisma/migrations/20261023000100_foundation/migration.sql`. PostgreSQL 18 хранит данные в bind mount `/srv/ventilyator/postgres` → `/var/lib/postgresql`; не меняйте major-версию образа без процедуры миграции PostgreSQL.

Созданы Organization, User, AuthIdentity, Role, Permission, RolePermission, UserRole, SessionMetadata, AuditEvent, StorageObject и StorageObjectVersion. Используются UUID, FK с явными onDelete, уникальные ключи, индексы и TIMESTAMPTZ(3). Prisma генерирует UUID на стороне приложения. Включён pg_trgm для последующей реализации поиска.

```bash
pnpm db:generate
pnpm db:migrate
```

Production применяет только `prisma migrate deploy`. Не используйте `db push` и destructive reset. Время хранится в UTC; клиент отображает его в часовом поясе браузера.

Для новой миграции используйте отдельную development-базу и `prisma migrate dev`, затем проверьте SQL и сценарий обновления с существующими данными. Сравните схему после миграций с Prisma schema через `prisma migrate diff`. Не применяйте команду разработки к production-базе.

SQL первой миграции проверен в PostgreSQL 18.1 на отдельной временной базе. Затем `prisma migrate deploy` успешно применил миграцию к основной development-базе; `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` подтвердил отсутствие расхождений. Повторное применение миграций при старте также прошло. Основная база не изменялась ручным выполнением SQL.

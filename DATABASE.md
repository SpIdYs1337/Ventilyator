# База данных

PostgreSQL 18 и Prisma 7 с PostgreSQL adapter. Применяйте только проверенные SQL migrations через `prisma migrate deploy`; db push/reset не предназначены для постоянной установки.

| Область | Основные таблицы |
|---|---|
| Организация/Identity | Organization, User, Role, Permission, RolePermission, UserRole, AuthIdentity, SessionMetadata, AuditEvent |
| Проекты/задачи | Project, ProjectMember, Task, TaskComment, TaskEvent, Sprint, ChecklistItem, TaskDependency, TaskWatch, TimeEntry, TaskTimer |
| Знания | KnowledgeSpace, SpaceMember, KnowledgePage, PageDraft, PageRevision, PageComment, PageTaskLink |
| Файлы | StorageObject, StorageObjectVersion, StorageAttachment, StorageUpload, StorageQuota |
| Настройки/уведомления | OrganizationSettings, UserPreferences, Notification, EmailDelivery |

Организация и пользователь определяются серверной сессией. Составные FK предотвращают межорганизационные связи проектов, задач, страниц, участников и вложений. Один upload принадлежит одному контексту; XOR task/page закреплён CHECK. Partial unique index допускает один активный спринт на проект; таймер уникален для пользователя. Версия карточки/публикации предотвращает потерю конкурентных изменений. Для записи используются транзакции и advisory locks проекта/пространства/пользователей/квоты.

Миграция `20261026000100_knowledge_platform` добавляет модули без пересоздания пользователей. Статус Task преобразуется из enum в VARCHAR(40) через `USING status::text`, сохраняя существующие значения. Стандартным ролям добавляются необходимые разрешения. Старые миграции не изменяются. Уже применённую миграцию не редактируйте.

Полнотекстовый поиск задач и страниц использует GIN/tsvector с русской и простой конфигурациями; запросы параметризованы, ACL входят в SQL. Project workflow хранится JSON и проверяется схемой/серверными переходами. Содержимое документа — валидируемый JSON плюс текст для поиска; личный PageDraft отделён от опубликованной KnowledgePage, PageRevision неизменяема через API.

EmailDelivery — постоянный outbox; Redis содержит очереди, сессии и heartbeat. Секрет SMTP зашифрован в БД, ключ находится вне неё в storage. Согласованный backup включает PostgreSQL и storage; Redis-сессии при восстановлении не переносятся.

Проверки: `tests/integration/migrations.py` применяет цепочку SQL к отдельной временной базе и проверяет сохранность задачи REVIEW, пользователя и назначение knowledge:create. Schema drift проверяется отдельно; результаты в DEVELOPMENT.md.

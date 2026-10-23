# Эксплуатация

Полная платформа ещё не готова к эксплуатации. Ниже команды для текущего инфраструктурного этапа.

```bash
docker compose ps
docker compose logs --tail=100 ventilyator-api ventilyator-worker
docker compose restart
docker compose down
docker compose up -d
```

`down` удаляет контейнеры и сети, но bind mounts сохраняются. Не используйте `down -v`, очистку каталогов или смену паролей в `.env` как способ диагностики. Смена пароля PostgreSQL в уже инициализированном каталоге требует согласованного изменения в самой БД.

## Обновление

Сделайте проверенную резервную копию и прочитайте changelog/migrations. Обновите исходники, соберите образы, остановите API/worker, выполните `docker compose run --rm ventilyator-migrate`, затем `docker compose up -d --build`. Проверьте readiness, вход и сохранность данных. Downgrade образа не отменяет миграцию БД; откат схемы требует отдельной проверенной процедуры восстановления.

## Диагностика

- Migration exited nonzero: проверьте доступ к PostgreSQL и SQL; не пытайтесь пропустить неприменённую миграцию.
- API initialization failed: проверьте обязательные переменные, HTTPS в production и права storage UID 1000.
- Worker unhealthy: проверьте Redis и PostgreSQL, heartbeat должен обновляться раз в 5 секунд и истекает через 20.
- 403 при POST: Origin браузера и APP_ORIGIN должны совпадать, включая порт; не отключайте CSRF.
- Prisma engine 403 при сборке: разрешите binaries.prisma.sh и сохраните TLS/checksum verification.
- Недостаточно места: остановите запись, расширьте диск или удалите только проверенные ненужные backup-файлы. Не удаляйте PostgreSQL WAL и файловые объекты вручную.

## Мониторинг Zabbix / Grafana

HTTP-проверки `/api/health/live` и `/api/health/ready`: ожидается 200, три последовательных отказа readiness — trigger; HTTPS проверяется с доверенным CA. Zabbix agent на Ubuntu контролирует диски DATA_ROOT, inode, память, CPU и Docker-сервисы. Доступ к Docker socket не выдавайте непривилегированному веб-процессу. Подробный статус компонентов требует административной сессии; не публикуйте его анонимно для мониторинга.

Zabbix и Grafana не требуются приложению. Prometheus-метрики времени запросов, очередей и storage ещё не реализованы и входят в этап 9.

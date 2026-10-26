#!/usr/bin/env python3
"""Run all SQL migrations in a disposable database, preserving an existing task."""
import os
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]


def main():
    env = dict(os.environ, COMPOSE_FILE=os.environ.get('VENTILYATOR_TEST_COMPOSE_FILES', 'docker-compose.yml:docker-compose.dev.yml'))
    compose = ['docker', 'compose']
    subprocess.run(compose + ['exec', '-T', 'ventilyator-api', 'node', '-e', "if(process.env.NODE_ENV!=='development')process.exit(1)"], cwd=ROOT, env=env, check=True, capture_output=True)
    name = 'vnt_migrate_' + uuid.uuid4().hex
    admin = compose + ['exec', '-T', 'ventilyator-postgres', 'psql', '-U', 'ventilyator', '-v', 'ON_ERROR_STOP=1', '-At']
    def sql(statement, database='ventilyator'):
        result = subprocess.run(admin + ['-d', database], cwd=ROOT, env=env, input=statement, text=True, capture_output=True, check=True)
        return result.stdout.strip()
    sql(f'CREATE DATABASE {name};')
    try:
        migrations = sorted((ROOT / 'packages/database/prisma/migrations').glob('*/migration.sql'))
        for path in migrations[:2]:
            sql(path.read_text(), name)
        org, user, project, task, role = [str(uuid.uuid4()) for _ in range(5)]
        seed = f'''INSERT INTO "Organization" (id,name) VALUES ('{org}','Migration proof');
INSERT INTO "User" (id,"organizationId",email,name,"updatedAt") VALUES ('{user}','{org}','migration-proof@example.org','Migration proof',now());
INSERT INTO "Role" (id,"organizationId",name) VALUES ('{role}','{org}','Team Member');
INSERT INTO "Project" (id,"organizationId","ownerId",key,name,"updatedAt") VALUES ('{project}','{org}','{user}','PROOF','Migration proof',now());
INSERT INTO "Task" (id,"organizationId","projectId",number,title,status,"authorId","updatedAt") VALUES ('{task}','{org}','{project}',1,'Preserve status','REVIEW','{user}',now());'''
        sql(seed, name)
        for path in migrations[2:]:
            sql(path.read_text(), name)
        print('PASS fresh database accepts the complete SQL migration chain')
        assert sql(f'''SELECT status || ':' || title FROM "Task" WHERE id='{task}';''', name) == 'REVIEW:Preserve status'
        assert sql(f'''SELECT email FROM "User" WHERE id='{user}';''', name) == 'migration-proof@example.org'
        print('PASS upgrade preserves existing task status, title and user')
        assert sql(f'''SELECT COUNT(*) FROM "RolePermission" WHERE "roleId"='{role}' AND permission='knowledge:create';''', name) == '1'
        assert sql("SELECT data_type FROM information_schema.columns WHERE table_name='Task' AND column_name='status';", name) == 'character varying'
        print('PASS workflow status conversion and standard role backfill')
    finally:
        sql(f'DROP DATABASE {name} WITH (FORCE);')


if __name__ == '__main__':
    main()

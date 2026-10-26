#!/usr/bin/env python3
"""Exercise backup/restore in a separate empty Compose project. Development only."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]
SOURCE_FILES = os.environ.get('VENTILYATOR_TEST_COMPOSE_FILES', 'docker-compose.yml:docker-compose.dev.yml')


def execute(args, env, data=None, capture=False):
    return subprocess.run(args, cwd=ROOT, env=env, input=data, text=True, check=True, capture_output=capture)


def node(script, env):
    result = execute(['docker', 'compose', 'exec', '-T', 'ventilyator-api', 'node', '-'], env, script, True)
    return result.stdout.strip()


def request(port, origin, path, method='GET', data=None, cookie=None, binary=None):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=30)
    headers = {'Origin': origin, 'X-Ventilyator-Request': '1', 'Content-Type': 'application/octet-stream' if binary is not None else 'application/json'}
    if cookie:
        headers['Cookie'] = cookie
    connection.request(method, '/api' + path, binary if binary is not None else json.dumps(data) if data is not None else None, headers)
    response = connection.getresponse()
    body = response.read()
    result = (response.status, json.loads(body) if 'application/json' in (response.getheader('content-type') or '') else body, response.getheader('set-cookie'))
    connection.close()
    return result


def main():
    env = dict(os.environ, COMPOSE_FILE=SOURCE_FILES)
    status = execute(['docker', 'compose', 'exec', '-T', 'ventilyator-api', 'node', '-e', "if(process.env.NODE_ENV!=='development')process.exit(1)"], env, capture=True)
    assert status.returncode == 0
    tag = uuid.uuid4().hex[:12]
    password, smtp_secret = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    data = json.dumps({'tag': tag, 'password': password})
    fixture = json.loads(node("const d=" + data + ";const {createDatabase}=require('./packages/database/dist');const {permissionKeys}=require('./packages/shared/dist');const a=require('./apps/api/node_modules/argon2');const db=createDatabase(process.env.DATABASE_URL);(async()=>{const org=await db.organization.create({data:{name:'Backup fixture '+d.tag}});const role=await db.role.create({data:{organizationId:org.id,name:'Backup Administrator',permissions:{create:permissionKeys.map(permission=>({permission}))}}});const user=await db.user.create({data:{organizationId:org.id,email:'backup-'+d.tag+'@example.org',name:'Backup fixture',passwordHash:await a.hash(d.password,{type:a.argon2id}),roles:{create:{roleId:role.id}}}});console.log(JSON.stringify({orgId:org.id,email:user.email}));await db.$disconnect()})().catch(()=>{process.exitCode=1})", env))
    validation = ROOT / '.local' / f'backup-validation-{tag}'
    validation.mkdir(mode=0o700)
    target = dict(env, COMPOSE_PROJECT_NAME=f'vnt-restore-{tag}', DATA_ROOT=str(validation / 'target-data'), HTTP_PORT='18081', APP_ORIGIN='http://localhost:18081')
    target['POSTGRES_PASSWORD'] = secrets.token_urlsafe(24)
    target['REDIS_PASSWORD'] = secrets.token_urlsafe(24)
    target['DATABASE_URL'] = f"postgresql://ventilyator:{target['POSTGRES_PASSWORD']}@ventilyator-postgres:5432/ventilyator"
    target['REDIS_URL'] = f"redis://:{target['REDIS_PASSWORD']}@ventilyator-redis:6379/0"
    target_started = False
    try:
        source_origin = 'http://localhost:8080'
        code, _, header = request(8080, source_origin, '/auth/login', 'POST', {'email': fixture['email'], 'password': password})
        assert code == 201
        cookie = header.split(';')[0]
        code, project, _ = request(8080, source_origin, '/projects', 'POST', {'key': 'BACKUP', 'name': 'Backup project'}, cookie)
        assert code == 201
        code, task, _ = request(8080, source_origin, f'/projects/{project["id"]}/tasks', 'POST', {'title': 'Preserve this task'}, cookie)
        assert code == 201
        code, space, _ = request(8080, source_origin, '/knowledge/spaces', 'POST', {'key': 'BACKUP', 'name': 'Backup knowledge'}, cookie)
        assert code == 201
        code, page, _ = request(8080, source_origin, f'/knowledge/spaces/{space["id"]}/pages', 'POST', {'title': 'Preserve this page'}, cookie)
        assert code == 201
        content = {'type': 'doc', 'content': [{'type': 'paragraph', 'content': [{'type': 'text', 'text': 'Restored knowledge content'}]}]}
        code, _, _ = request(8080, source_origin, f'/knowledge/spaces/{space["id"]}/pages/{page["id"]}/publish', 'POST', {'title': 'Preserve this page', 'content': content, 'baseRevision': 0}, cookie)
        assert code == 201
        payload = b'Backup restore bytes, local storage and SHA-256'
        code, ticket, _ = request(8080, source_origin, f'/files/task/{task["id"]}/uploads', 'POST', {'name': 'backup-proof.txt', 'size': len(payload)}, cookie)
        assert code == 201
        assert request(8080, source_origin, f'/files/uploads/{ticket["id"]}', 'PUT', cookie=cookie, binary=payload)[0] == 200
        settings = {'smtpEnabled': False, 'smtpHost': '', 'smtpPort': 465, 'smtpMode': 'TLS', 'smtpUser': '', 'smtpPassword': smtp_secret, 'senderEmail': '', 'senderName': 'Ventilyator', 'imapEnabled': False, 'imapHost': '', 'imapPort': 993, 'imapDomain': None, 'imapAutoCreate': False, 'imapRoleId': None}
        assert request(8080, source_origin, '/admin/mail', 'PUT', settings, cookie)[0] == 200
        execute(['python3', 'infrastructure/scripts/backup.py', '--output', str(validation / 'backups')], env, capture=True)
        backups = list((validation / 'backups').iterdir())
        assert len(backups) == 1
        backup = backups[0]
        execute(['python3', 'infrastructure/scripts/backup.py', '--verify', str(backup)], env, capture=True)
        print('PASS consistent source backup and checksum validation', flush=True)
        if shutil.which('sudo'):
            execute(['sudo', '-n', 'sh', 'infrastructure/scripts/prepare-host.sh', target['DATA_ROOT']], env, capture=True)
        else:
            Path(target['DATA_ROOT']).mkdir(mode=0o700)
            config = json.loads(execute(['docker', 'compose', 'config', '--format', 'json'], env, capture=True).stdout)
            image = config['services']['ventilyator-api']['image']
            execute(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '0:0', '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'FOWNER', '-v', f'{target["DATA_ROOT"]}:/target', '-v', f'{ROOT}/infrastructure/scripts/prepare-host.sh:/prepare-host.sh:ro', '--entrypoint', 'sh', image, '/prepare-host.sh', '/target'], env, capture=True)
        target_started = True
        execute(['docker', 'compose', 'up', '-d', '--wait', '--wait-timeout', '180', 'ventilyator-postgres', 'ventilyator-redis'], target, capture=True)
        execute(['python3', 'infrastructure/scripts/restore.py', str(backup)], target, capture=True)
        execute(['python3', 'infrastructure/scripts/restore.py', str(backup), '--apply-empty-target'], target, capture=True)
        execute(['docker', 'compose', 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180'], target, capture=True)
        origin = 'http://localhost:18081'
        code, _, header = request(18081, origin, '/auth/login', 'POST', {'email': fixture['email'], 'password': password})
        assert code == 201
        restored_cookie = header.split(';')[0]
        assert request(18081, origin, f'/projects/{project["id"]}/tasks/{task["id"]}', cookie=restored_cookie)[1]['title'] == 'Preserve this task'
        assert request(18081, origin, f'/knowledge/spaces/{space["id"]}/pages/{page["id"]}', cookie=restored_cookie)[1]['content'] == content
        downloaded = request(18081, origin, f'/files/{ticket["objectId"]}/download', cookie=restored_cookie)
        assert downloaded[0] == 200 and hashlib.sha256(downloaded[1]).digest() == hashlib.sha256(payload).digest()
        print('PASS separate restore: login, task, knowledge page and protected file bytes', flush=True)
        verify = "const {createDatabase}=require('./packages/database/dist');const {decryptSecret}=require('./packages/config/dist');const db=createDatabase(process.env.DATABASE_URL);(async()=>{const row=await db.organizationSettings.findUnique({where:{organizationId:ORG}});if(await decryptSecret(process.env.STORAGE_ROOT,ORG,row.smtpSecret)!==SECRET)throw Error('secret mismatch');await db.$disconnect();console.log('verified')})().catch(()=>{process.exitCode=1})".replace('ORG', json.dumps(fixture['orgId'])).replace('SECRET', json.dumps(smtp_secret))
        assert node(verify, target) == 'verified'
        print('PASS encrypted SMTP configuration restored with its filesystem key', flush=True)
        refused = subprocess.run(['python3', 'infrastructure/scripts/restore.py', str(backup), '--apply-empty-target'], cwd=ROOT, env=target, capture_output=True, text=True)
        assert refused.returncode != 0
        print('PASS restore refuses to overwrite a nonempty installation', flush=True)
    finally:
        if target_started:
            execute(['docker', 'compose', 'down'], target, capture=True)
        org = json.dumps(fixture['orgId'])
        cleanup = "const {createDatabase}=require('./packages/database/dist');const db=createDatabase(process.env.DATABASE_URL);const Redis=require('./apps/api/node_modules/ioredis');const fs=require('node:fs/promises'),p=require('node:path');(async()=>{const ids=await db.storageObject.findMany({where:{organizationId:ORG}});for(const o of ids)await fs.rm(p.join(process.env.STORAGE_ROOT,'objects',o.id.slice(0,2),o.id.slice(2,4),o.id),{recursive:true,force:true});await db.storageObjectVersion.deleteMany({where:{object:{organizationId:ORG}}});await db.storageObject.deleteMany({where:{organizationId:ORG}});await db.task.deleteMany({where:{organizationId:ORG}});await db.project.deleteMany({where:{organizationId:ORG}});await db.knowledgeSpace.deleteMany({where:{organizationId:ORG}});await db.auditEvent.deleteMany({where:{organizationId:ORG}});const sessions=await db.sessionMetadata.findMany({where:{user:{organizationId:ORG}}});const r=new Redis(process.env.REDIS_URL);if(sessions.length)await r.del(...sessions.map(s=>'session:'+s.id));r.disconnect();await db.user.deleteMany({where:{organizationId:ORG}});await db.role.deleteMany({where:{organizationId:ORG}});await db.organization.delete({where:{id:ORG}});await db.$disconnect()})().catch(()=>{process.exitCode=1})".replace('ORG', org)
        node(cleanup, env)


if __name__ == '__main__':
    main()

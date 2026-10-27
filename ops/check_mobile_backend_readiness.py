#!/usr/bin/env python3
"""Read-only live compatibility probe. No login, registration, send, migration or restart."""
import argparse
import json
import re
import subprocess
from pathlib import Path

REMOTE_PROBE = r'''
import json, os
import django
django.setup()
from django.conf import settings
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.urls import resolve, Resolver404
from config.celery import app
from api.v1.tenants.serializers import TenantSettingsSerializer
routes = {}
for path, method in [
    ("/api/v1/auth/push/installations/", "post"),
    ("/api/v1/auth/push/revoke/", "post"),
    ("/api/v1/sales/notifications/1/", "get"),
    ("/api/v1/sales/capabilities/", "get"),
    ("/api/v1/inventory/operations/capabilities/", "get"),
    ("/api/v1/cashbox/capabilities/", "get"),
    ("/api/v1/sales/b2b/capabilities/", "get"),
    ("/api/v1/sales/counterparties/1/payments/quote/", "get"),
]:
    try:
        match = resolve(path)
        view = getattr(match.func, "view_class", None)
        routes[path] = bool(view and callable(getattr(view, method, None)))
    except Resolver404:
        routes[path] = False
with transaction.atomic(), connection.cursor() as cursor:
    cursor.execute("SET TRANSACTION READ ONLY")
    cursor.execute("SELECT app, name FROM django_migrations ORDER BY app, name")
    latest = {}
    for app_label, name in cursor.fetchall():
        latest[app_label] = name
    executor = MigrationExecutor(connection)
    pending = [f"{migration.app_label}.{migration.name}" for migration, _ in executor.migration_plan(executor.loader.graph.leaf_nodes())]
key_path = getattr(settings, "FCM_SERVICE_ACCOUNT_FILE", "")
report = {
    "django": django.get_version(),
    "uid": os.getuid(), "gid": os.getgid(),
    "notification_app_installed": "apps.notifications" in settings.INSTALLED_APPS,
    "push_enabled": bool(getattr(settings, "MOBILE_PUSH_ENABLED", False)),
    "push_project_configured": bool(getattr(settings, "FCM_PROJECT_ID", "")),
    "push_file_configured": bool(key_path),
    "push_file_readable": bool(key_path and os.path.isfile(key_path) and os.access(key_path, os.R_OK)),
    "dispatch_scheduled": any(value.get("task") == "apps.notifications.tasks.dispatch_push_events" for value in app.conf.beat_schedule.values()),
    "required_route_handlers": routes,
    "latest_migrations": latest,
    "pending_migrations": pending,
    "tenant_settings_revision_supported": "settings_revision" in TenantSettingsSerializer().fields,
}
report["mobile_backend_routes_ready"] = all(routes.values()) and report["notification_app_installed"] and not pending and report["tenant_settings_revision_supported"]
print(json.dumps(report, sort_keys=True))
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ssh-target', required=True)
    parser.add_argument('--identity-file', type=Path, required=True)
    parser.add_argument('--container', default='ilbi-platform-ilbi-1')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--require-ready', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z_][a-z0-9_-]*@[A-Za-z0-9.-]+', args.ssh_target):
        parser.error('An explicit user@host SSH target is required.')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*', args.container):
        parser.error('Invalid container name.')
    if not args.identity_file.is_file():
        parser.error('SSH identity file does not exist.')
    result = subprocess.run([
        'ssh', '-i', str(args.identity_file), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
        '-o', 'StrictHostKeyChecking=yes', args.ssh_target,
        f'docker exec -i {args.container} python -B -',
    ], input=REMOTE_PROBE, text=True, capture_output=True, timeout=60, check=False)
    if result.returncode:
        # Do not forward arbitrary remote tracebacks/settings/credential output.
        raise SystemExit(f'Read-only probe failed (exit {result.returncode}); inspect the host securely.')
    try:
        report = json.loads(result.stdout)
    except ValueError:
        raise SystemExit('Read-only probe returned an invalid sanitized report; inspect the host securely.') from None
    text = json.dumps(report, indent=2, sort_keys=True) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text)
    print(text, end='')
    return 1 if args.require_ready and not report['mobile_backend_routes_ready'] else 0


if __name__ == '__main__':
    raise SystemExit(main())

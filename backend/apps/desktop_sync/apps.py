from django.apps import AppConfig


class DesktopSyncConfig(AppConfig):
    name = "apps.desktop_sync"

    def ready(self):
        from django.db.models.signals import m2m_changed, post_delete, post_save

        from .revisions import changed

        post_save.connect(changed, weak=False, dispatch_uid="ilbi-sync-revision-save")
        post_delete.connect(changed, weak=False, dispatch_uid="ilbi-sync-revision-delete")
        m2m_changed.connect(changed, weak=False, dispatch_uid="ilbi-sync-revision-m2m")

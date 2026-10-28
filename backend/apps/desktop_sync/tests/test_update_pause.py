import threading

from django.test import RequestFactory, override_settings

from apps.desktop_sync import worker
from apps.desktop_sync.middleware import DesktopMiddleware


def test_update_pause_waits_for_active_sync_and_prevents_new_cycles(monkeypatch):
    lock = threading.Lock()
    paused = threading.Event()
    monkeypatch.setattr(worker, 'cycle_lock', lock)
    monkeypatch.setattr(worker, 'update_paused', paused)
    lock.acquire()
    assert worker.pause_for_update(timeout=.01) is False
    assert not paused.is_set()
    lock.release()
    assert worker.pause_for_update(timeout=.1) is True
    assert paused.is_set()
    worker.resume_after_update()
    assert not paused.is_set()


@override_settings(DESKTOP_BRIDGE_KEY='bridge-test', DESKTOP_UPDATE_KEY='native-update-test')
def test_only_native_update_key_can_pause_or_resume(monkeypatch):
    calls = []
    monkeypatch.setattr(worker, 'pause_for_update', lambda: calls.append('pause') or True)
    monkeypatch.setattr(worker, 'resume_after_update', lambda: calls.append('resume'))
    middleware = DesktopMiddleware(lambda _: None)
    factory = RequestFactory()
    for value in ['', 'wrong']:
        request = factory.post('/desktop/update/prepare/', HTTP_X_ILBI_DESKTOP_KEY='bridge-test', HTTP_X_ILBI_UPDATE_KEY=value)
        assert middleware(request).status_code == 403
    assert calls == []
    for action in ['prepare', 'resume']:
        request = factory.post(f'/desktop/update/{action}/', HTTP_X_ILBI_DESKTOP_KEY='bridge-test', HTTP_X_ILBI_UPDATE_KEY='native-update-test')
        assert middleware(request).status_code == 200
    assert calls == ['pause', 'resume']

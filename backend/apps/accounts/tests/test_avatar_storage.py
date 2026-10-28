import io
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event, local

import pytest
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, close_old_connections, connection, transaction
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from tests.factories import StaffFactory

pytestmark = pytest.mark.django_db(transaction=True)
AVATAR_URL = "/api/v1/auth/profile/avatar/"


def image_upload():
    data = io.BytesIO()
    Image.new("RGB", (1200, 800), "blue").save(data, format="PNG")
    return SimpleUploadedFile("photo.png", data.getvalue(), content_type="image/png")


def avatar_request(user, method="post"):
    client = APIClient(raise_request_exception=False)
    client.force_authenticate(user=user)
    if method == "post":
        return client.post(AVATAR_URL, {"avatar": image_upload()}, format="multipart")
    return client.delete(AVATAR_URL)


@pytest.fixture
def avatar_state(tmp_path, monkeypatch, settings):
    settings.MEDIA_ROOT = tmp_path
    # Exercise overwrite storage too: a replacement must never reuse a live name.
    storage = FileSystemStorage(location=tmp_path, allow_overwrite=True)
    monkeypatch.setattr(User._meta.get_field("avatar"), "storage", storage)
    user = StaffFactory()
    old_name = storage.save("accounts/avatars/photo.webp", ContentFile(b"original-avatar"))
    user.avatar = old_name
    user.save(update_fields=["avatar"])
    return user, storage, old_name


def stored_files(storage):
    return {
        path.relative_to(storage.location).as_posix() for path in Path(storage.location).rglob("*") if path.is_file()
    }


def assert_original_preserved(user, storage, old_name):
    user.refresh_from_db()
    assert user.avatar.name == old_name
    with storage.open(old_name) as saved:
        assert saved.read() == b"original-avatar"
    assert stored_files(storage) == {old_name}


def test_upload_replaces_avatar_with_resized_webp(avatar_state):
    user, storage, old_name = avatar_state
    response = avatar_request(user)
    assert response.status_code == 200
    user.refresh_from_db()
    assert user.avatar.name != old_name
    assert response.data["avatar"].endswith(user.avatar.name)
    assert stored_files(storage) == {user.avatar.name}
    with storage.open(user.avatar.name) as saved, Image.open(saved) as image:
        assert image.format == "WEBP"
        assert max(image.size) == 640


@pytest.mark.parametrize("method", ["post", "delete"])
def test_old_avatar_is_deleted_only_after_commit(avatar_state, method):
    user, storage, old_name = avatar_state
    with transaction.atomic():
        response = avatar_request(user, method)
        assert response.status_code == 200
        user.refresh_from_db()
        assert user.avatar.name != old_name
        assert storage.exists(old_name)
    assert not storage.exists(old_name)


@pytest.mark.parametrize("after_write", [False, True])
def test_storage_failure_preserves_old_avatar(avatar_state, monkeypatch, after_write):
    user, storage, old_name = avatar_state
    save = storage.save

    def fail_save(name, content, **kwargs):
        if after_write:
            save(name, content, **kwargs)
        raise OSError("synthetic storage failure")

    monkeypatch.setattr(storage, "save", fail_save)
    assert avatar_request(user).status_code == 500
    assert_original_preserved(user, storage, old_name)


@pytest.mark.parametrize("method", ["post", "delete"])
def test_database_write_failure_rolls_back_and_preserves_old_avatar(avatar_state, monkeypatch, method):
    user, storage, old_name = avatar_state
    save = User.save

    def fail_save(instance, *args, **kwargs):
        save(instance, *args, **kwargs)
        if kwargs.get("update_fields") == ["avatar"]:
            raise DatabaseError("synthetic database write failure")

    monkeypatch.setattr(User, "save", fail_save)
    assert avatar_request(user, method).status_code == 500
    assert_original_preserved(user, storage, old_name)


@pytest.mark.parametrize("method", ["post", "delete"])
def test_database_commit_failure_preserves_old_avatar(avatar_state, monkeypatch, method):
    user, storage, old_name = avatar_state

    def fail_commit():
        raise DatabaseError("synthetic commit failure")

    with monkeypatch.context() as patch:
        patch.setattr(connection, "commit", fail_commit)
        assert avatar_request(user, method).status_code == 500
    assert_original_preserved(user, storage, old_name)


def test_uncertain_commit_never_deletes_the_referenced_new_file(avatar_state, monkeypatch):
    user, storage, old_name = avatar_state
    commit = connection.commit

    def commit_then_fail():
        commit()
        raise DatabaseError("synthetic lost commit acknowledgement")

    with monkeypatch.context() as patch:
        patch.setattr(connection, "commit", commit_then_fail)
        assert avatar_request(user).status_code == 500
    user.refresh_from_db()
    assert user.avatar.name != old_name
    assert storage.exists(user.avatar.name)
    # The uncertain result may retain an orphan, but neither image is destroyed.
    assert storage.exists(old_name)


@pytest.mark.parametrize("method", ["post", "delete"])
def test_cleanup_failure_keeps_successful_database_change(avatar_state, monkeypatch, caplog, method):
    user, storage, old_name = avatar_state

    def fail_delete(name):
        raise OSError("synthetic private storage details")

    monkeypatch.setattr(storage, "delete", fail_delete)
    assert avatar_request(user, method).status_code == 200
    user.refresh_from_db()
    assert user.avatar.name != old_name
    assert bool(user.avatar) is (method == "post")
    if user.avatar:
        assert storage.exists(user.avatar.name)
    assert storage.exists(old_name)
    assert "Avatar file cleanup failed" in caplog.text
    assert "synthetic private storage details" not in caplog.text


def test_shared_legacy_avatar_is_not_deleted(avatar_state):
    user, storage, old_name = avatar_state
    other = StaffFactory(avatar=old_name)
    assert avatar_request(user).status_code == 200
    other.refresh_from_db()
    assert other.avatar.name == old_name
    assert storage.exists(old_name)


@pytest.mark.parametrize("method", ["post", "delete"])
def test_stale_authenticated_user_uses_current_database_avatar(avatar_state, method):
    user, storage, old_name = avatar_state
    assert avatar_request(user).status_code == 200
    intermediate = User.objects.get(pk=user.pk).avatar.name
    assert user.avatar.name == old_name  # Deliberately stale request user.
    assert avatar_request(user, method).status_code == 200
    user.refresh_from_db()
    assert not storage.exists(intermediate)
    assert stored_files(storage) == ({user.avatar.name} if user.avatar else set())


def test_invalid_upload_preserves_existing_avatar(avatar_state):
    user, storage, old_name = avatar_state
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.post(
        AVATAR_URL,
        {"avatar": SimpleUploadedFile("avatar.html", b"<script>bad</script>", content_type="text/html")},
        format="multipart",
    )
    assert response.status_code == 400
    assert_original_preserved(user, storage, old_name)


def test_delete_without_avatar_is_idempotent(avatar_state):
    user, storage, _ = avatar_state
    assert avatar_request(user, "delete").status_code == 200
    assert avatar_request(user, "delete").status_code == 200
    user.refresh_from_db()
    assert not user.avatar
    assert stored_files(storage) == set()


@pytest.mark.parametrize("second_method", ["post", "delete"])
def test_parallel_avatar_changes_leave_only_current_file(avatar_state, monkeypatch, second_method):
    user, storage, old_name = avatar_state
    first_saved = Event()
    second_lock_attempt = Event()
    release_first = Event()
    operation = local()
    save = storage.save

    def paused_save(*args, **kwargs):
        name = save(*args, **kwargs)
        if operation.name == "first":
            first_saved.set()
            assert release_first.wait(timeout=15)
        return name

    def observe_lock(execute, sql, params, many, context):
        if "FOR UPDATE" in sql.upper():
            second_lock_attempt.set()
        return execute(sql, params, many, context)

    def request_in_thread(name, method):
        close_old_connections()
        operation.name = name
        try:
            if name == "second":
                with connection.execute_wrapper(observe_lock):
                    return avatar_request(user, method).status_code
            return avatar_request(user, method).status_code
        finally:
            close_old_connections()

    monkeypatch.setattr(storage, "save", paused_save)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(request_in_thread, "first", "post")
        try:
            assert first_saved.wait(timeout=10)
            second = pool.submit(request_in_thread, "second", second_method)
            assert second_lock_attempt.wait(timeout=10)
            assert not second.done()
        finally:
            release_first.set()
        assert first.result(timeout=15) == 200
        assert second.result(timeout=15) == 200

    user.refresh_from_db()
    assert not storage.exists(old_name)
    assert bool(user.avatar) is (second_method == "post")
    assert stored_files(storage) == ({user.avatar.name} if user.avatar else set())

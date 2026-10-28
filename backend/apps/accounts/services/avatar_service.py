import logging
from functools import partial
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import transaction

logger = logging.getLogger(__name__)


def _delete_unreferenced_avatar(storage, name):
    """Do not fail a saved update or delete a file that is still referenced."""
    try:
        # Also protect against an uncertain commit outcome or a shared legacy file.
        if not get_user_model().objects.filter(avatar=name).exists():
            storage.delete(name)
    except Exception:
        logger.warning("Avatar file cleanup failed; manual cleanup may be needed.")


def set_user_avatar(*, user_id, image):
    """Set an optimized image, or clear it with None, without deleting live files."""
    new_name = None
    storage = None
    try:
        with transaction.atomic():
            # Authentication may have loaded an older avatar before another upload.
            user = get_user_model().objects.select_for_update().get(pk=user_id)
            old_name = user.avatar.name
            storage = user.avatar.storage

            if image is not None:
                field = user._meta.get_field("avatar")
                # Never overwrite the previous file, including on overwrite storage.
                new_name = field.generate_filename(user, f"{uuid4().hex}.webp")
                new_name = storage.save(new_name, image, max_length=field.max_length)
                user.avatar = new_name
                user.save(update_fields=["avatar"])
            elif old_name:
                user.avatar = None
                user.save(update_fields=["avatar"])

            if old_name and old_name != new_name:
                transaction.on_commit(partial(_delete_unreferenced_avatar, storage, old_name), robust=True)
        return user
    except Exception:
        # After rollback, remove the unused upload. If commit outcome is unknown,
        # check the reference first; a DB outage also leaves the file in place.
        if storage is not None and new_name:
            _delete_unreferenced_avatar(storage, new_name)
        raise

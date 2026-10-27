import base64
import hashlib
import secrets

from cryptography.fernet import Fernet
from django.conf import settings
from django.db import IntegrityError, transaction
from rest_framework.exceptions import ValidationError

from .models import PushInstallation

CATEGORIES = frozenset(["b2b", "debts", "stock", "reports", "system"])


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def cipher():
    key = hashlib.sha256(("ilbi-push-token-v1:" + settings.SECRET_KEY).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


@transaction.atomic
def register_installation(user, values):
    installation = PushInstallation.objects.select_for_update().filter(pk=values["installation_id"]).first()
    secret_hash = digest(values["revoke_secret"])
    if installation and not secrets.compare_digest(installation.revoke_secret_digest, secret_hash):
        raise ValidationError({"installation_id": "Qurilma identity’si tasdiqlanmadi."})
    token_hash = digest(values["token"])
    if PushInstallation.objects.filter(token_digest=token_hash).exclude(pk=values["installation_id"]).exists():
        raise ValidationError({"token": "Qurilma tokeni boshqa o‘rnatmaga tegishli. Tokenni qayta oling."})
    values_to_save = {
        "user": user,
        "token_version": user.token_version,
        "is_active": True,
        "token_ciphertext": cipher().encrypt(values["token"].encode()).decode(),
        "token_digest": token_hash,
        "revoke_secret_digest": secret_hash,
        "categories": values.get("categories", {}),
    }
    if installation is None:
        try:
            with transaction.atomic():
                return PushInstallation.objects.create(id=values["installation_id"], **values_to_save)
        except IntegrityError as error:
            raise ValidationError({"installation_id": "Qurilma ro‘yxati o‘zgardi. Qayta urining."}) from error
    for field, value in values_to_save.items():
        setattr(installation, field, value)
    installation.save()
    return installation


def revoke_installation(installation_id, secret):
    installation = PushInstallation.objects.filter(pk=installation_id).first()
    if installation and secrets.compare_digest(installation.revoke_secret_digest, digest(secret)):
        PushInstallation.objects.filter(pk=installation.pk).update(is_active=False)

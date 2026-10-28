"""Request-local business time for delayed offline commands; wall clock stays real."""

from contextvars import ContextVar

from django.db import models
from django.utils import timezone as django_timezone

event_time = ContextVar("ilbi_event_time", default=None)


def now():
    return event_time.get() or django_timezone.now()


def localtime(value=None, timezone=None):
    return django_timezone.localtime(value or now(), timezone)


def localdate(value=None, timezone=None):
    return localtime(value, timezone).date()


class EventDateTimeField(models.DateTimeField):
    def pre_save(self, model_instance, add):
        if event_time.get() and (self.auto_now or (self.auto_now_add and add)):
            value = now()
            setattr(model_instance, self.attname, value)
            return value
        return super().pre_save(model_instance, add)

    def deconstruct(self):
        name, _path, args, kwargs = super().deconstruct()
        return name, "django.db.models.DateTimeField", args, kwargs

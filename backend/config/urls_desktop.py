from django.conf import settings
from django.urls import path, re_path
from django.views.static import serve

from .urls import urlpatterns as base_patterns

urlpatterns = [
    path("desktop/<path:action>", lambda request, action: None),  # handled by the outer desktop middleware
    re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
    *base_patterns,
]

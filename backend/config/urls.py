from apps.core.media_views import media_file
from django.conf import settings
from django.urls import include, path, re_path

urlpatterns = [
    # API v1 endpoints
    path("api/v1/", include("api.v1.urls")),
    # Uploaded avatars and product images
    re_path(r"^media/(?P<path>.*)$", media_file),
]

if settings.API_DOCS_ENABLED:
    from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView

    urlpatterns += [
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
        path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
    ]

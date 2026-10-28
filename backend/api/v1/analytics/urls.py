from django.urls import path

from api.v1.analytics.views.dashboard_views import DashboardView

urlpatterns = [
    path('dashboard/', DashboardView.as_view(), name='analytics-dashboard'),
]

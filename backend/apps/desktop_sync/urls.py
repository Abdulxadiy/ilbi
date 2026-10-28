from django.urls import path

from .device_credentials import DeviceSessionView

from .pairing import PairingClaimView, PairingCreateView, PairingOwnerView, PairingResultView
from .views import (
    ActorGrantView,
    ChangesView,
    CredentialVerifyView,
    DeviceEnrollView,
    DeviceRevokeView,
    PushView,
    SecurityStateView,
    SnapshotView,
)

urlpatterns = [
    path("session/", DeviceSessionView.as_view()),
    path("pairings/", PairingCreateView.as_view()),
    path("pairings/claim/", PairingClaimView.as_view()),
    path("pairings/result/", PairingResultView.as_view()),
    path("pairings/<uuid:pairing_id>/", PairingOwnerView.as_view()),
    path("credentials/", CredentialVerifyView.as_view()),
    path("security/", SecurityStateView.as_view()),
    path("devices/", DeviceEnrollView.as_view()),
    path("actors/", ActorGrantView.as_view()),
    path("devices/<uuid:device_id>/revoke/", DeviceRevokeView.as_view()),
    path("snapshot/", SnapshotView.as_view()),
    path("changes/", ChangesView.as_view()),
    path("push/", PushView.as_view()),
]

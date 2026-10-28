from django.urls import path

from . import views
from .settings_views import SupportTelegramSettingsView, SupportTelegramTestView

urlpatterns = [
    path("metadata/", views.MetadataView.as_view()),
    path("settings/telegram/", SupportTelegramSettingsView.as_view()),
    path("settings/telegram/test/", SupportTelegramTestView.as_view()),
]
for prefix, listing, detail, messages, image, voice in [
    (
        "conversations/",
        views.ConversationsView,
        views.ConversationView,
        views.MessagesView,
        views.ImageView,
        views.VoiceView,
    ),
    (
        "guest/",
        views.GuestConversationsView,
        views.GuestConversationView,
        views.GuestMessagesView,
        views.GuestImageView,
        views.GuestVoiceView,
    ),
    (
        "inbox/",
        views.InboxView,
        views.OperatorConversationView,
        views.OperatorMessagesView,
        views.OperatorImageView,
        views.OperatorVoiceView,
    ),
]:
    urlpatterns += [
        path(prefix, listing.as_view()),
        path(prefix + "<uuid:pk>/", detail.as_view()),
        path(prefix + "<uuid:pk>/messages/", messages.as_view()),
        path(prefix + "<uuid:pk>/messages/<int:message_id>/image/", image.as_view()),
        path(prefix + "<uuid:pk>/messages/<int:message_id>/voice/", voice.as_view()),
    ]

urlpatterns += [
    path("inbox/<uuid:pk>/customer/", views.CustomerProfileView.as_view()),
]

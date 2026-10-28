from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.mixins import TenantContextMixin
from api.pagination import StandardResultsSetPagination
from api.query_params import positive_id
from api.v1.sales.serializers import NotificationOutputSerializer
from apps.sales.models import Notification


class NotificationListView(TenantContextMixin, APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: NotificationOutputSerializer(many=True)})
    def get(self, request):
        if self.tenant and self.tenant.owner_id == request.user.pk:
            from apps.sales.services.debt_reminder_service import notify_due_debts
            notify_due_debts(tenant_id=self.tenant.pk)
        if request.user.role == 'platform_admin':
            qs = Notification.objects.filter(recipient=request.user)
        else:
            if not self.tenant:
                return Response([])
            qs = Notification.objects.filter(tenant=self.tenant, recipient=request.user)
        if request.query_params.get('page'):
            unread_count = qs.filter(is_read=False).count()
            after = positive_id(request.query_params.get('after_id'), 'after_id')
            before = positive_id(request.query_params.get('before_id'), 'before_id')
            if after:
                qs = qs.filter(pk__gt=after).order_by('pk')
            else:
                if before:
                    qs = qs.filter(pk__lt=before)
                qs = qs.order_by('-pk')
            paginator = StandardResultsSetPagination()
            rows = paginator.paginate_queryset(qs, request)
            response = paginator.get_paginated_response(NotificationOutputSerializer(rows, many=True).data)
            response.data['unread_count'] = unread_count
            response.data['next_before_id'] = (
                min((row.pk for row in rows), default=None) if response.data['next'] and not after else None
            )
            return response
        return Response(NotificationOutputSerializer(qs, many=True).data)

    @extend_schema(request=None, responses={204: None})
    def delete(self, request):
        """Clear all notifications for the current user."""
        if request.user.role == 'platform_admin':
            Notification.objects.filter(recipient=request.user).delete()
        else:
            if not self.tenant:
                return Response(status=status.HTTP_204_NO_CONTENT)
            Notification.objects.filter(tenant=self.tenant, recipient=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NotificationDetailView(TenantContextMixin, APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: NotificationOutputSerializer})
    def get(self, request, pk):
        qs = Notification.objects.filter(recipient=request.user)
        if request.user.role != 'platform_admin':
            qs = qs.filter(tenant=self.tenant) if self.tenant else qs.none()
        return Response(NotificationOutputSerializer(get_object_or_404(qs, pk=pk)).data)

    @extend_schema(request=None, responses={204: None})
    def delete(self, request, pk):
        """Delete an individual notification."""
        if request.user.role == 'platform_admin':
            notif = get_object_or_404(Notification, pk=pk, recipient=request.user)
        else:
            if not self.tenant:
                return Response({"detail": "Do'kon topilmadi."}, status=status.HTTP_403_FORBIDDEN)
            notif = get_object_or_404(Notification, pk=pk, tenant=self.tenant, recipient=request.user)
        notif.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NotificationReadView(TenantContextMixin, APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        if request.user.role == 'platform_admin':
            notif = get_object_or_404(Notification, pk=pk, recipient=request.user)
        else:
            if not self.tenant:
                return Response({"detail": "Do'kon topilmadi."}, status=status.HTTP_403_FORBIDDEN)
            notif = get_object_or_404(Notification, pk=pk, tenant=self.tenant, recipient=request.user)
        notif.is_read = True
        notif.save(update_fields=['is_read'])
        return Response({"detail": "Xabarnoma o'qildi deb belgilandi."}, status=status.HTTP_200_OK)


class NotificationReadAllView(TenantContextMixin, APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=None,
        responses={200: inline_serializer(
            name="NotificationReadAllResponse",
            fields={"unread_count": serializers.IntegerField(min_value=0)},
        )},
    )
    def post(self, request):
        qs = Notification.objects.filter(recipient=request.user)
        if request.user.role != 'platform_admin':
            qs = qs.filter(tenant=self.tenant) if self.tenant else qs.none()
        qs.filter(is_read=False).update(is_read=True)
        return Response({'unread_count': 0})

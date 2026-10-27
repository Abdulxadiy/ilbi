from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.urls import path
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.mixins import OwnerStaffOnlyAPIView
from apps.accounts.models import Employee
from apps.accounts.services.permission_service import PermissionService
from apps.catalog.models import ProductVariant
from apps.core import event_clock as timezone
from apps.core.models import WorkspaceReminder
from apps.core.services.workspace_notifications import notify_assignment, mark_reminder_notifications_read
from apps.sales.models import Counterparty, Sale


class WorkspaceView(OwnerStaffOnlyAPIView):
    permission_classes = [IsAuthenticated]

    @property
    def is_owner(self):
        return self.employee and self.employee.is_owner and self.tenant.owner_id == self.request.user.pk

    def reminders(self):
        rows = WorkspaceReminder.objects.filter(tenant=self.tenant).select_related("assigned_to", "created_by")
        if not self.is_owner:
            rows = rows.filter(Q(assigned_to=self.request.user) | Q(created_by=self.request.user))
        return rows


class ReminderInputSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200)
    due_at = serializers.DateTimeField()
    assigned_to_id = serializers.IntegerField(required=False, min_value=1)
    completed = serializers.BooleanField(required=False)


class ReminderOutputSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.SerializerMethodField()
    completed = serializers.SerializerMethodField()
    overdue = serializers.SerializerMethodField()

    class Meta:
        model = WorkspaceReminder
        fields = [
            "id",
            "title",
            "due_at",
            "assigned_to_id",
            "assigned_to_name",
            "created_by_id",
            "completed",
            "completed_at",
            "overdue",
        ]

    def get_assigned_to_name(self, obj) -> str:
        return obj.assigned_to.get_full_name() or obj.assigned_to.username

    def get_completed(self, obj) -> bool:
        return obj.completed_at is not None

    def get_overdue(self, obj) -> bool:
        return obj.completed_at is None and obj.due_at <= timezone.now()


class ReminderListOutputSerializer(serializers.Serializer):
    results = ReminderOutputSerializer(many=True)
    count = serializers.IntegerField()
    overdue_count = serializers.IntegerField()


class WorkspaceMemberSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


def reminder_assignee(view, data):
    user_id = data.pop("assigned_to_id", view.request.user.pk)
    if not view.is_owner and user_id != view.request.user.pk:
        raise PermissionDenied("Boshqa xodimga eslatma biriktirish uchun do‘kon egasi bo‘lish kerak.")
    membership = get_object_or_404(Employee, user_id=user_id, tenant=view.tenant, is_active=True)
    return membership.user_id


class ReminderListView(WorkspaceView):
    @extend_schema(
        responses=ReminderListOutputSerializer,
        parameters=[OpenApiParameter("page", int), OpenApiParameter("completed", str)],
    )
    def get(self, request):
        rows = self.reminders()
        status = request.query_params.get("completed", "false")
        if status != "all":
            rows = rows.filter(completed_at__isnull=status != "true")
        page = serializers.IntegerField(min_value=1, max_value=100000).run_validation(
            request.query_params.get("page", 1)
        )
        return Response(
            {
                "results": ReminderOutputSerializer(rows[(page - 1) * 50 : page * 50], many=True).data,
                "count": rows.count(),
                "overdue_count": self.reminders().filter(completed_at__isnull=True, due_at__lte=timezone.now()).count(),
            }
        )

    @extend_schema(request=ReminderInputSerializer, responses={201: ReminderOutputSerializer})
    @transaction.atomic
    def post(self, request):
        serializer = ReminderInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        assignee_id = reminder_assignee(self, data)
        completed = data.pop("completed", False)
        reminder = WorkspaceReminder.objects.create(
            tenant=self.tenant,
            created_by=request.user,
            assigned_to_id=assignee_id,
            completed_at=timezone.now() if completed else None,
            **data,
        )
        notify_assignment(reminder, request.user)
        return Response(ReminderOutputSerializer(reminder).data, status=201)


class ReminderDetailView(WorkspaceView):
    @extend_schema(request=ReminderInputSerializer, responses=ReminderOutputSerializer)
    @transaction.atomic
    def patch(self, request, pk):
        reminder = get_object_or_404(self.reminders().select_for_update(of=('self',)), pk=pk)
        serializer = ReminderInputSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        previous_assignee, previous_due, was_completed = reminder.assigned_to_id, reminder.due_at, reminder.completed_at is not None
        if "assigned_to_id" in data:
            reminder.assigned_to_id = reminder_assignee(self, data)
        if "completed" in data:
            reminder.completed_at = timezone.now() if data.pop("completed") else None
        for field in ("title", "due_at"):
            if field in data:
                setattr(reminder, field, data[field])
        changed_assignment = previous_assignee != reminder.assigned_to_id
        if changed_assignment or previous_due != reminder.due_at or (was_completed and reminder.completed_at is None):
            mark_reminder_notifications_read(reminder)
            reminder.due_notified_at = None
        if reminder.completed_at is not None:
            mark_reminder_notifications_read(reminder)
        reminder.save()
        if changed_assignment:
            notify_assignment(reminder, request.user)
        return Response(ReminderOutputSerializer(reminder).data)

    @extend_schema(responses={204: None})
    def delete(self, request, pk):
        with transaction.atomic():
            reminder = get_object_or_404(self.reminders().select_for_update(of=('self',)), pk=pk)
            mark_reminder_notifications_read(reminder)
            reminder.delete()
        return Response(status=204)


class WorkspaceMembersView(WorkspaceView):
    @extend_schema(responses=WorkspaceMemberSerializer(many=True))
    def get(self, request):
        memberships = Employee.objects.filter(tenant=self.tenant, is_active=True).select_related("user")
        if not self.is_owner:
            memberships = memberships.filter(user=request.user)
        return Response(
            [
                {"id": item.user_id, "name": item.user.get_full_name() or item.user.username}
                for item in memberships.order_by("user_id")
            ]
        )


class WorkspaceSearchView(WorkspaceView):
    @extend_schema(responses={200: OpenApiTypes.OBJECT}, parameters=[OpenApiParameter("q", str)])
    def get(self, request):
        query = request.query_params.get("q", "").strip()[:100]
        if len(query) < 2:
            return Response({"results": []})
        results = []

        def permitted(*codes):
            return any(PermissionService.has_permission(request.user, code, tenant=self.tenant) for code in codes)

        if permitted("catalog.view_product", "sales.add_sale"):
            rows = (
                ProductVariant.objects.filter(tenant=self.tenant, is_active=True, product__is_active=True)
                .filter(Q(product__name__icontains=query) | Q(name__icontains=query) | Q(barcode__icontains=query))
                .select_related("product")
                .order_by("product__name", "pk")[:6]
            )
            results.extend(
                {
                    "id": row.pk,
                    "type": "product",
                    "title": f"{row.product.name} · {row.name}",
                    "subtitle": row.barcode or "",
                    "url": "/catalog",
                    "search": row.product.name,
                }
                for row in rows
            )
        if permitted("sales.manage_counterparty", "sales.record_debt_payment"):
            rows = (
                Counterparty.objects.filter(tenant=self.tenant, is_active=True)
                .filter(Q(name__icontains=query) | Q(phone_number__icontains=query))
                .order_by("name", "pk")[:6]
            )
            results.extend(
                {
                    "id": row.pk,
                    "type": "customer",
                    "title": row.name,
                    "subtitle": row.phone_number,
                    "url": "/debts",
                    "search": row.phone_number,
                }
                for row in rows
            )
        if permitted("sales.view_sale"):
            rows = Sale.objects.filter(tenant=self.tenant, receipt_number__icontains=query).order_by("-pk")[:6]
            results.extend(
                {
                    "id": row.pk,
                    "type": "sale",
                    "title": row.receipt_number,
                    "subtitle": f"{row.total_amount} {row.currency}",
                    "url": "/sales",
                    "search": row.receipt_number,
                }
                for row in rows
            )
        return Response({"results": results})


class WorkspaceOverviewView(WorkspaceView):
    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        def allowed(code):
            return PermissionService.has_permission(request.user, code, tenant=self.tenant)

        low_stock = None
        if allowed("inventory.view_stock"):
            low_stock = (
                ProductVariant.objects.filter(tenant=self.tenant, is_active=True, product__is_active=True)
                .filter(Q(stock__quantity__lte=5) | Q(stock__isnull=True))
                .count()
            )
        sales = []
        if allowed("sales.view_sale"):
            rows = (
                Sale.objects.filter(tenant=self.tenant)
                .select_related("sold_by", "counterparty")
                .order_by("-created_at", "-pk")[:5]
            )
            sales = [
                {
                    "id": row.pk,
                    "receipt_number": row.receipt_number,
                    "created_at": row.created_at,
                    "total_amount": str(row.total_amount),
                    "currency": row.currency,
                    "status": row.get_status_display(),
                    "customer": row.counterparty.name if row.counterparty else "Chakana savdo",
                    "cashier": row.sold_by.get_full_name() or row.sold_by.username,
                }
                for row in rows
            ]
        return Response({"low_stock_count": low_stock, "recent_sales": sales})


urlpatterns = [
    path("overview/", WorkspaceOverviewView.as_view(), name="workspace-overview"),
    path("search/", WorkspaceSearchView.as_view(), name="workspace-search"),
    path("members/", WorkspaceMembersView.as_view(), name="workspace-members"),
    path("reminders/", ReminderListView.as_view(), name="workspace-reminders"),
    path("reminders/<int:pk>/", ReminderDetailView.as_view(), name="workspace-reminder-detail"),
]

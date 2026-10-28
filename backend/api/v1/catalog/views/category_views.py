from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response

from api.query_params import positive_id
from api.permissions import HasEmployeePermission
from api.schema import optional_pagination
from api.v1.catalog.serializers import (
    CategoryCreateSerializer,
    CategoryOutputSerializer,
    CategoryUpdateSerializer,
)
from apps.catalog.models import Category
from apps.catalog.services import CategoryService, CategoryServiceError

from ._base import CatalogAPIView


class CategoryListCreateView(CatalogAPIView):
    """GET  /api/v1/catalog/categories/
    POST /api/v1/catalog/categories/"""

    history_model = Category
    permission_classes = [HasEmployeePermission]
    permission_map = {"GET": "catalog.view_category", "POST": "catalog.add_category"}

    @extend_schema(request=None, responses={200: optional_pagination(CategoryOutputSerializer)})
    def get(self, request):
        categories = Category.objects.filter(tenant=self.tenant, is_active=True)
        search = request.query_params.get("search")
        if search:
            s = search.strip()
            categories = categories.filter(Q(name__icontains=s) | Q(kod__icontains=s))
        currency = request.query_params.get("currency")
        if currency:
            categories = categories.filter(currency=currency.upper())
        parent = request.query_params.get("parent")
        if parent == "null" or parent == "none" or parent == "0":
            categories = categories.filter(parent__isnull=True)
        elif parent:
            categories = categories.filter(parent_id=positive_id(parent, "parent"))

        if request.query_params.get("page"):
            from api.pagination import StandardResultsSetPagination
            paginator = StandardResultsSetPagination()
            page_data = paginator.paginate_queryset(categories, request)
            return paginator.get_paginated_response(CategoryOutputSerializer(page_data, many=True).data)

        return Response(CategoryOutputSerializer(categories, many=True).data)

    @extend_schema(request=CategoryCreateSerializer, responses={201: CategoryOutputSerializer})
    def post(self, request):
        serializer = CategoryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            category = CategoryService.create(tenant=self.tenant, **serializer.validated_data)
        except CategoryServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(CategoryOutputSerializer(category).data, status=status.HTTP_201_CREATED)


class CategoryDetailView(CatalogAPIView):
    """GET   /api/v1/catalog/categories/{pk}/
    PATCH /api/v1/catalog/categories/{pk}/"""

    history_model = Category
    permission_classes = [HasEmployeePermission]
    permission_map = {
        "GET": "catalog.view_category",
        "PATCH": "catalog.change_category",
        "DELETE": "catalog.archive_category",
    }

    @extend_schema(request=None, responses={200: CategoryOutputSerializer})
    def get(self, request, pk):
        # Filtering by tenant here does double duty: a category that
        # exists but belongs to a different tenant 404s exactly the
        # same way as one that doesn't exist at all -- no cross-tenant
        # existence leak.
        category = get_object_or_404(Category, pk=pk, tenant=self.tenant)
        return Response(CategoryOutputSerializer(category).data)

    @extend_schema(request=CategoryUpdateSerializer, responses={200: CategoryOutputSerializer})
    def patch(self, request, pk):
        category = get_object_or_404(Category, pk=pk, tenant=self.tenant)
        serializer = CategoryUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        try:
            category = CategoryService.update(category, **serializer.validated_data)
        except CategoryServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(CategoryOutputSerializer(category).data)

    @extend_schema(request=None, responses={204: None})
    def delete(self, request, pk):
        category = get_object_or_404(Category, pk=pk, tenant=self.tenant)
        try:
            CategoryService.delete(category)
        except CategoryServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CategoryArchiveView(CatalogAPIView):
    """POST /api/v1/catalog/categories/{pk}/archive/"""

    history_model = Category
    permission_classes = [HasEmployeePermission]
    required_permission = "catalog.archive_category"

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: CategoryOutputSerializer})
    def post(self, request, pk):
        category = get_object_or_404(Category, pk=pk, tenant=self.tenant)
        category = CategoryService.archive(category)
        return Response(CategoryOutputSerializer(category).data)

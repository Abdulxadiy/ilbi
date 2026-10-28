from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.schema import AvatarUploadInputSerializer, PasswordChangeInputSerializer
from api.v1.accounts.serializers import (
    UserProfileSerializer,
    UserProfileUpdateSerializer,
)
from apps.accounts.services.avatar_service import set_user_avatar
from apps.core.utils.image_optimizer import optimize_image


class UserProfileView(APIView):
    """
    GET /api/v1/auth/profile/  -> Returns current authenticated user's profile details.
    PATCH /api/v1/auth/profile/ -> Updates first_name, last_name, email, date_of_birth.
    """
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: UserProfileSerializer})
    def get(self, request):
        serializer = UserProfileSerializer(request.user, context={'request': request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(request=UserProfileUpdateSerializer, responses={200: UserProfileSerializer})
    def patch(self, request):
        serializer = UserProfileUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = request.user
        if 'first_name' in data:
            user.first_name = data['first_name']
        if 'last_name' in data:
            user.last_name = data['last_name']
        if 'email' in data:
            user.email = data['email']
        if 'date_of_birth' in data:
            user.date_of_birth = data['date_of_birth']
        if 'contact_phone' in data:
            raw_contact = data['contact_phone']
            if raw_contact:
                norm = user.__class__.objects.normalize_phone_number(raw_contact)
                user.contact_phone = norm or None
            else:
                user.contact_phone = None

        user.profile_completed = True
        user.save(update_fields=[*data.keys(), "profile_completed"])

        out = UserProfileSerializer(user, context={'request': request})
        return Response(out.data, status=status.HTTP_200_OK)


class UserAvatarUploadView(APIView):
    """
    POST /api/v1/auth/profile/avatar/   -> Uploads/changes user avatar image (MinIO).
    DELETE /api/v1/auth/profile/avatar/ -> Removes user avatar.
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(request=AvatarUploadInputSerializer, responses={200: UserProfileSerializer})
    def post(self, request):
        if 'avatar' not in request.FILES:
            return Response(
                {'error': 'Avatar fayli topilmadi'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = AvatarUploadInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            avatar_file = optimize_image(serializer.validated_data['avatar'], max_dimension=640)
        except ValidationError as exc:
            return Response({'avatar': exc.messages}, status=400)
        user = set_user_avatar(user_id=request.user.pk, image=avatar_file)

        out = UserProfileSerializer(user, context={'request': request})
        return Response(out.data, status=status.HTTP_200_OK)

    @extend_schema(request=None, responses={200: UserProfileSerializer})
    def delete(self, request):
        user = set_user_avatar(user_id=request.user.pk, image=None)

        out = UserProfileSerializer(user, context={'request': request})
        return Response(out.data, status=status.HTTP_200_OK)


class ChangePasswordView(APIView):
    """
    POST /api/v1/auth/change-password/
    Change password for the authenticated user by verifying old_password.
    """
    permission_classes = [IsAuthenticated]

    @extend_schema(request=PasswordChangeInputSerializer, responses={200: OpenApiTypes.OBJECT})
    @transaction.atomic
    def post(self, request):
        old_password = request.data.get('old_password')
        new_password = request.data.get('new_password')

        if not old_password or not new_password:
            return Response(
                {'error': 'Joriy parol va yangi parol kiritilishi shart.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if len(new_password) < 8:
            return Response(
                {'error': 'Yangi parol kamida 8 ta belgidan iborat bo‘lishi kerak.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = get_user_model().objects.select_for_update().get(pk=request.user.pk)
        if not user.is_active or user.token_version != request.user.token_version:
            return Response({'detail': 'Sessiya bekor qilingan.'}, status=status.HTTP_401_UNAUTHORIZED)
        if not user.check_password(old_password):
            return Response(
                {'error': 'Joriy parol noto‘g‘ri kiritildi.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            validate_password(new_password, user)
        except ValidationError as exc:
            return Response({'new_password': exc.messages}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(new_password)
        user.token_version = getattr(user, 'token_version', 1) + 1
        user.save(update_fields=["password", "token_version"])

        # Audit log
        try:
            from apps.core.models import AuditAction
            from apps.core.services.audit_service import AuditService
            AuditService.log(
                action=AuditAction.PASSWORD_RESET,
                actor=user,
                tenant=getattr(user, 'tenant', None),
                target_model="User",
                target_id=str(user.id),
                changes={"token_version": user.token_version},
                description=f"User {user.phone_number or user.username} changed password via profile",
            )
        except Exception:
            pass

        return Response(
            {'message': 'Parol muvaffaqiyatli o‘zgartirildi!'},
            status=status.HTTP_200_OK,
        )


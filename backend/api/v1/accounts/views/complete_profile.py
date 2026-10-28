from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.v1.accounts.serializers import CompleteProfileSerializer


class CompleteProfileView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=CompleteProfileSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        serializer = CompleteProfileSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = request.user
        user.first_name = data.get('first_name', '')
        user.last_name = data.get('last_name', '')
        user.email = data.get('email', '')
        if data.get('date_of_birth'):                   # date_of_birth is optional; only update it if the client actually sent a value,
            user.date_of_birth = data['date_of_birth']  # since data.get() returns None when the key is missing.

        if 'contact_phone' in data:
            raw_contact = data.get('contact_phone')
            if raw_contact:
                norm = user.__class__.objects.normalize_phone_number(raw_contact)
                user.contact_phone = norm or None
            else:
                user.contact_phone = None

        user.profile_completed = True
        user.save(update_fields=[
            "first_name", "last_name", "email", "date_of_birth", "contact_phone", "profile_completed",
        ])
        return Response(status=status.HTTP_200_OK)

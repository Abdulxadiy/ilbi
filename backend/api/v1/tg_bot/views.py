from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import IsInternalService

from .serializers import TelegramContactSerializer


class RegisterTelegramContactView(APIView):
    permission_classes = [IsInternalService]

    @extend_schema(request=TelegramContactSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        serializer = TelegramContactSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.v1.accounts.serializers import UserProfileSerializer


def get_client_ip(request):
    """Extract real client IP address from HTTP headers or remote addr."""
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded_for:
        return x_forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


class AcceptTermsView(APIView):
    """
    POST /api/v1/auth/accept-terms/
    Records the user's explicit legal agreement to Public Offer (Ommaviy Oferta),
    Privacy Policy (Maxfiylik Siyosati), and Terms of Service.
    Saves timestamp and client IP for audit proof.
    """
    permission_classes = [IsAuthenticated]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: UserProfileSerializer})
    def post(self, request):
        user = request.user
        user.terms_accepted = True
        user.terms_accepted_at = timezone.now()
        user.terms_accepted_ip = get_client_ip(request)
        user.save(update_fields=["terms_accepted", "terms_accepted_at", "terms_accepted_ip"])

        serializer = UserProfileSerializer(user, context={"request": request})
        return Response(
            {
                "message": "Ommaviy oferta va maxfiylik shartlariga rozilik muvaffaqiyatli qayd etildi.",
                "user": serializer.data,
            },
            status=status.HTTP_200_OK,
        )

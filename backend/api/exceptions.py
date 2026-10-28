"""
api/exceptions.py — DRF uchun yagona xatoliklar standarti (Custom Exception Handler).
Barcha HTTP 4xx va 5xx DRF xatoliklarini bitta standart qolipga soladi:
{
    "error": {
        "code": "validation_error" | "not_found" | "permission_denied" | "server_error",
        "message": "Asosiy xatolik matni",
        "details": { ... } yoki null
    }
}
"""
from rest_framework.views import exception_handler
from rest_framework.exceptions import (
    ValidationError,
    NotFound,
    PermissionDenied,
    AuthenticationFailed,
    NotAuthenticated,
)


def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)

    if response is None:
        from apps.inventory.services.stock_service import StockServiceError
        from apps.sales.services.sale_service import SaleServiceError
        from apps.sales.services.void_service import VoidServiceError
        if isinstance(exc, (StockServiceError, SaleServiceError, VoidServiceError)):
            from rest_framework.response import Response
            from rest_framework import status
            return Response(
                {
                    "error": {
                        "code": "business_logic_error",
                        "message": str(exc),
                        "details": None,
                    },
                    "detail": str(exc),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Standard Python exceptions (like ImproperlyConfigured) should bubble up
        # to allow Django's default handler or pytest.raises to catch them.
        return None

    code = "error"
    message = "Xatolik yuz berdi."
    details = None

    if isinstance(exc, ValidationError):
        code = "validation_error"
        message = "Kiritilgan ma'lumotlarda xatolik bor."
        details = response.data
    elif isinstance(exc, (AuthenticationFailed, NotAuthenticated)):
        code = "authentication_error"
        message = response.data.get("detail", "Autentifikatsiyadan o'tilmagan.")
    elif isinstance(exc, PermissionDenied):
        code = "permission_denied"
        message = response.data.get("detail", "Ushbu amalni bajarishga ruxsatingiz yo'q.")
    elif isinstance(exc, NotFound):
        code = "not_found"
        message = response.data.get("detail", "So'ralgan ma'lumot topilmadi.")
    else:
        code = getattr(exc, "default_code", "client_error")
        if isinstance(response.data, dict) and "detail" in response.data:
            message = response.data["detail"]
        elif isinstance(response.data, dict) and "error" in response.data:
            # Already structured error
            return response
        else:
            details = response.data

    data = {
        "error": {
            "code": code,
            "message": str(message),
            "details": details,
        }
    }

    # Backward compatibility: expose validation field keys at top level
    if isinstance(details, dict):
        for k, v in details.items():
            if k not in data:
                data[k] = v

    response.data = data
    return response

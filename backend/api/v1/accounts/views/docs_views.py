from pathlib import Path
import logging

from django.conf import settings
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from api.schema import DocumentUpdateInputSerializer

logger = logging.getLogger(__name__)

DOCS_MAP = {
    "yordam_uz": {
        "file": "qollanmalar/yordam_uz.md", "title": "Boshlash va yordam",
        "roles": ["public", "staff", "owner", "platform_admin"], "category": "practical",
    },

    # 1. Amaliy Vizual Qo'llanmalar (Rasmlar bilan)
    "platform_admin_amaliy_qollanma": {
        "file": "qollanmalar/platform_admin_amaliy_qollanma.md",
        "title": "Platform Admin: Amaliy Vizual Qo'llanma",
        "roles": ["platform_admin"],
        "category": "practical",
    },
    "owner_amaliy_qollanma": {
        "file": "qollanmalar/owner_amaliy_qollanma.md",
        "title": "Do'kon Egasi: Amaliy Vizual Qo'llanma",
        "roles": ["owner", "platform_admin"],
        "category": "practical",
    },
    "staff_amaliy_qollanma": {
        "file": "qollanmalar/staff_amaliy_qollanma.md",
        "title": "Xodimlar: Amaliy Vizual Qo'llanma",
        "roles": ["staff", "owner", "platform_admin"],
        "category": "practical",
    },
    # 2. Tizim Reglamenti va Me'yoriy Qoidalar
    "platform_admin_qollanma": {
        "file": "qollanmalar/platform_admin_qollanma.md",
        "title": "Platform Admin Reglamenti",
        "roles": ["platform_admin"],
        "category": "manual",
    },
    "owner_qollanma": {
        "file": "qollanmalar/owner_qollanma.md",
        "title": "Do'kon Egasi Reglamenti",
        "roles": ["owner", "platform_admin"],
        "category": "manual",
    },
    "staff_qollanma": {
        "file": "qollanmalar/staff_qollanma.md",
        "title": "Xodimlar Reglamenti",
        "roles": ["staff", "owner", "platform_admin"],
        "category": "manual",
    },
    # 3. Yuridik Hujjatlar
    "ommaviy_oferta": {
        "file": "hujjatlar/ommaviy_oferta.md",
        "title": "Ommaviy Oferta Shartnomasi",
        "roles": ["staff", "owner", "platform_admin", "public"],
        "category": "legal",
    },
    "maxfiylik_siyosati": {
        "file": "hujjatlar/maxfiylik_siyosati.md",
        "title": "Maxfiylik Siyosati",
        "roles": ["staff", "owner", "platform_admin", "public"],
        "category": "legal",
    },
    "foydalanish_qoidalari": {
        "file": "hujjatlar/foydalanish_qoidalari.md",
        "title": "Xizmatdan Foydalanish Qoidalari",
        "roles": ["staff", "owner", "platform_admin", "public"],
        "category": "legal",
    },
}


def _get_docs_root() -> Path:
    """Find docs directory relative to repo root, container /app/docs, or /docs."""
    base_dir = Path(settings.BASE_DIR)

    # 1. Host repo root: base_dir.parent / "docs" (e.g. ilbi/docs when running outside container)
    candidate_parent = base_dir.parent / "docs"
    if candidate_parent.exists() and (candidate_parent / "qollanmalar").exists():
        return candidate_parent

    # 2. Container /app/docs: base_dir / "docs" (inside container)
    candidate_app = base_dir / "docs"
    if candidate_app.exists() and (candidate_app / "qollanmalar").exists():
        return candidate_app

    # 3. Third priority: /docs inside container
    candidate_root = Path("/docs")
    if candidate_root.exists() and (candidate_root / "qollanmalar").exists():
        return candidate_root

    # Fallback to whichever exists
    if candidate_parent.exists():
        return candidate_parent
    return candidate_app


class DocumentationView(APIView):
    """
    GET /api/v1/docs/?doc=<doc_name>
    Returns list of accessible docs or content of a specific doc according to role.
    
    PUT /api/v1/docs/
    Only platform_admin can edit and save markdown documentation.
    """
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        user = request.user
        role = getattr(user, "role", None) if user.is_authenticated else "public"
        docs_root = _get_docs_root()

        doc_key = request.query_params.get("doc")
        if not doc_key:
            # Return list of accessible docs for current user
            accessible = []
            for key, meta in DOCS_MAP.items():
                if "public" in meta["roles"] or (role and role in meta["roles"]):
                    accessible.append({
                        "key": key,
                        "title": meta["title"],
                        "category": meta["category"],
                        "can_edit": bool(role == "platform_admin"),
                    })
            return Response({"documents": accessible, "user_role": role}, status=status.HTTP_200_OK)

        if doc_key not in DOCS_MAP:
            return Response(
                {"error": f"'{doc_key}' nomli hujjat topilmadi."},
                status=status.HTTP_404_NOT_FOUND,
            )

        meta = DOCS_MAP[doc_key]
        if "public" not in meta["roles"]:
            if not user.is_authenticated or role not in meta["roles"]:
                return Response(
                    {"error": "Sizda ushbu qo'llanmani ko'rish huquqi mavjud emas."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        file_path = docs_root / meta["file"]
        if not file_path.exists():
            return Response(
                {"error": "Hujjat fayli tizimda topilmadi."},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            content = file_path.read_text(encoding="utf-8")
        except Exception as exc:
            logger.error('Document read failed: document=%s error=%s', doc_key, type(exc).__name__)
            return Response(
                {"error": "Hujjatni hozir ochib bo‘lmadi. Keyinroq qayta urinib ko‘ring."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                "key": doc_key,
                "title": meta["title"],
                "category": meta["category"],
                "content": content,
                "can_edit": bool(role == "platform_admin"),
            },
            status=status.HTTP_200_OK,
        )

    @extend_schema(request=DocumentUpdateInputSerializer, responses={200: OpenApiTypes.OBJECT})
    def put(self, request):
        user = request.user
        if not user.is_authenticated or getattr(user, "role", None) != "platform_admin":
            return Response(
                {"error": "Faqat Platform Administratori qo'llanmalarni o'zgartirishi mumkin."},
                status=status.HTTP_403_FORBIDDEN,
            )

        doc_key = request.data.get("doc")
        content = request.data.get("content")

        if not doc_key or content is None:
            return Response(
                {"error": "'doc' va 'content' maydonlari majburiy."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if doc_key not in DOCS_MAP:
            return Response(
                {"error": f"'{doc_key}' nomli hujjat mavjud emas."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        docs_root = _get_docs_root()
        meta = DOCS_MAP[doc_key]
        file_path = docs_root / meta["file"]

        try:
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(content, encoding="utf-8")
        except Exception as exc:
            logger.error('Document write failed: document=%s error=%s', doc_key, type(exc).__name__)
            return Response(
                {"error": "Hujjatni hozir saqlab bo‘lmadi. Keyinroq qayta urinib ko‘ring."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                "message": f"'{meta['title']}' hujjati muvaffaqiyatli saqlandi.",
                "doc": doc_key,
            },
            status=status.HTTP_200_OK,
        )


def documentation_image(request, filename):
    """Public, synthetic tutorial crops only; never serve arbitrary repository paths."""
    import re

    from django.http import FileResponse, Http404
    if request.method not in ('GET', 'HEAD') or not re.fullmatch(r'[a-z0-9_-]+\.png', filename):
        raise Http404
    path = _get_docs_root() / 'rasmlar' / 'focused' / filename
    if not path.is_file():
        raise Http404
    response = FileResponse(path.open('rb'), content_type='image/png')
    response['X-Content-Type-Options'] = 'nosniff'
    response['Cache-Control'] = 'public, max-age=3600'
    return response

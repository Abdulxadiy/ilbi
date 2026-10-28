import pytest
from api.v1.accounts.views import docs_views
from rest_framework import status
from rest_framework.test import APIClient
from tests.factories import OwnerFactory, PlatformAdminFactory, StaffFactory

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def isolated_docs(tmp_path, monkeypatch):
    """Keep documentation GET/PUT tests entirely inside their own temporary files."""
    docs_root = tmp_path / "docs"
    for key, meta in docs_views.DOCS_MAP.items():
        path = docs_root / meta["file"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"# Sun’iy test hujjati: {key}\n", encoding="utf-8")
    monkeypatch.setattr(docs_views, "_get_docs_root", lambda: docs_root)
    return docs_root


def test_accept_terms_requires_authentication():
    client = APIClient()
    response = client.post("/api/v1/auth/accept-terms/")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


def test_accept_terms_success():
    user = StaffFactory(terms_accepted=False, terms_accepted_at=None, terms_accepted_ip=None)
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.post("/api/v1/auth/accept-terms/", REMOTE_ADDR="195.158.10.25")
    assert response.status_code == status.HTTP_200_OK
    assert response.data["user"]["terms_accepted"] is True
    assert response.data["user"]["terms_accepted_ip"] == "195.158.10.25"

    user.refresh_from_db()
    assert user.terms_accepted is True
    assert user.terms_accepted_at is not None
    assert user.terms_accepted_ip == "195.158.10.25"


def test_docs_list_by_role():
    client = APIClient()

    # Staff list
    staff = StaffFactory()
    client.force_authenticate(user=staff)
    res_staff = client.get("/api/v1/docs/")
    assert res_staff.status_code == status.HTTP_200_OK
    staff_doc_keys = [d["key"] for d in res_staff.data["documents"]]
    assert "staff_qollanma" in staff_doc_keys
    assert "ommaviy_oferta" in staff_doc_keys
    assert "owner_qollanma" not in staff_doc_keys
    assert "platform_admin_qollanma" not in staff_doc_keys

    # Owner list
    owner = OwnerFactory()
    client.force_authenticate(user=owner)
    res_owner = client.get("/api/v1/docs/")
    assert res_owner.status_code == status.HTTP_200_OK
    owner_doc_keys = [d["key"] for d in res_owner.data["documents"]]
    assert "owner_qollanma" in owner_doc_keys
    assert "staff_qollanma" in owner_doc_keys
    assert "platform_admin_qollanma" not in owner_doc_keys

    # Admin list
    admin = PlatformAdminFactory()
    client.force_authenticate(user=admin)
    res_admin = client.get("/api/v1/docs/")
    assert res_admin.status_code == status.HTTP_200_OK
    admin_doc_keys = [d["key"] for d in res_admin.data["documents"]]
    assert "platform_admin_qollanma" in admin_doc_keys
    assert "owner_qollanma" in admin_doc_keys
    assert "staff_qollanma" in admin_doc_keys
    assert "ommaviy_oferta" in admin_doc_keys


def test_docs_get_detail_permissions():
    client = APIClient()
    staff = StaffFactory()
    owner = OwnerFactory()
    admin = PlatformAdminFactory()

    # Public doc is accessible to all
    res_public = client.get("/api/v1/docs/?doc=ommaviy_oferta")
    assert res_public.status_code == status.HTTP_200_OK
    assert "content" in res_public.data

    # Staff accessing staff doc
    client.force_authenticate(user=staff)
    res_staff_ok = client.get("/api/v1/docs/?doc=staff_qollanma")
    assert res_staff_ok.status_code == status.HTTP_200_OK
    assert res_staff_ok.data["can_edit"] is False

    # Staff accessing owner doc -> 403
    res_staff_forbidden = client.get("/api/v1/docs/?doc=owner_qollanma")
    assert res_staff_forbidden.status_code == status.HTTP_403_FORBIDDEN

    # Staff accessing platform admin doc -> 403
    res_staff_admin_forbidden = client.get("/api/v1/docs/?doc=platform_admin_qollanma")
    assert res_staff_admin_forbidden.status_code == status.HTTP_403_FORBIDDEN

    # Owner accessing admin doc -> 403
    client.force_authenticate(user=owner)
    res_owner_admin_forbidden = client.get("/api/v1/docs/?doc=platform_admin_qollanma")
    assert res_owner_admin_forbidden.status_code == status.HTTP_403_FORBIDDEN

    # Admin accessing admin doc -> 200 with can_edit True
    client.force_authenticate(user=admin)
    res_admin_ok = client.get("/api/v1/docs/?doc=platform_admin_qollanma")
    assert res_admin_ok.status_code == status.HTTP_200_OK
    assert res_admin_ok.data["can_edit"] is True


def test_docs_edit_only_platform_admin(isolated_docs):
    client = APIClient()
    staff = StaffFactory()
    owner = OwnerFactory()
    admin = PlatformAdminFactory()

    # Staff cannot edit
    client.force_authenticate(user=staff)
    res_staff_put = client.put(
        "/api/v1/docs/",
        {"doc": "staff_qollanma", "content": "# Hacked Content"},
        format="json",
    )
    assert res_staff_put.status_code == status.HTTP_403_FORBIDDEN

    # Owner cannot edit
    client.force_authenticate(user=owner)
    res_owner_put = client.put(
        "/api/v1/docs/",
        {"doc": "owner_qollanma", "content": "# Hacked Content"},
        format="json",
    )
    assert res_owner_put.status_code == status.HTTP_403_FORBIDDEN

    # Admin can edit
    client.force_authenticate(user=admin)
    # Read the synthetic fixture through the real API before editing it.
    get_res = client.get("/api/v1/docs/?doc=staff_qollanma")
    assert get_res.status_code == status.HTTP_200_OK
    original_content = get_res.data["content"]
    updated_content = original_content + "\n\n<!-- updated_test_tag -->"

    # Perform edit
    edit_res = client.put(
        "/api/v1/docs/",
        {"doc": "staff_qollanma", "content": updated_content},
        format="json",
    )
    assert edit_res.status_code == status.HTTP_200_OK

    # Verify content updated
    updated_res = client.get("/api/v1/docs/?doc=staff_qollanma")
    assert updated_res.status_code == status.HTTP_200_OK
    assert updated_res.data["content"] == updated_content
    saved_file = isolated_docs / docs_views.DOCS_MAP["staff_qollanma"]["file"]
    assert saved_file.read_text(encoding="utf-8") == updated_content

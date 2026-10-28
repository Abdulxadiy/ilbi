import base64
from io import BytesIO
from pathlib import Path, PurePosixPath

import requests
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test.client import BOUNDARY, MULTIPART_CONTENT, encode_multipart
from rest_framework.parsers import MultiPartParser
from rest_framework.request import Request


def encode_request(request):
    if request.content_type == "application/json":
        import json

        return json.loads(request.body or b"{}")
    if request.content_type == "multipart/form-data":
        parsed = MultiPartParser().parse(
            BytesIO(request.body), request.META["CONTENT_TYPE"], {"request": Request(request)}
        )
        files = []
        total = 0
        for name, values in parsed.files.lists():
            for item in values:
                total += item.size
                if total > 10 * 1024 * 1024:
                    raise ValueError("Offline yuborish uchun jami fayllar 10 MB dan kichik bo‘lsin.")
                files.append(
                    {
                        "field": name,
                        "name": Path(item.name).name,
                        "type": item.content_type,
                        "data": base64.b64encode(item.read()).decode(),
                    }
                )
        return {"_multipart": True, "fields": dict(parsed.data.lists()), "files": files}
    if request.method == "DELETE" and not request.body:
        return {}
    raise ValueError("Bu ma’lumot formati offline rejimda qo‘llanmaydi.")


def decode_body(body):
    if not body.get("_multipart"):
        import json

        return json.dumps(body), "application/json"
    data = dict(body["fields"])
    total = 0
    for file in body["files"]:
        binary = base64.b64decode(file["data"], validate=True)
        total += len(binary)
        if total > 20 * 1024 * 1024:
            raise ValueError("Fayllar hajmi juda katta.")
        uploaded = SimpleUploadedFile(Path(file["name"]).name, binary, file["type"])
        data.setdefault(file["field"], []).append(uploaded)
    return encode_multipart(BOUNDARY, data), MULTIPART_CONTENT


def cache_media(snapshot, server, on_progress=None):
    from django.apps import apps
    from django.db.models import FileField

    paths = set()
    for row in snapshot["rows"]:
        for field in apps.get_model(row["model"])._meta.fields:
            value = row["fields"].get(field.name)
            if isinstance(field, FileField) and value:
                paths.add(value)
    missing = []
    for index, value in enumerate(sorted(paths)):
        if on_progress:
            on_progress(index, len(paths))
        path = PurePosixPath(value)
        if path.is_absolute() or any(part in {"..", "."} or part.startswith(".") for part in path.parts):
            continue
        destination = Path(settings.MEDIA_ROOT).joinpath(*path.parts)
        if destination.exists():
            continue
        try:
            response = requests.get(
                server.rstrip("/") + "/media/" + str(path), timeout=(5, 20), allow_redirects=False, stream=True
            )
            if not response.ok:
                missing.append(value)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_suffix(destination.suffix + ".part")
            size = 0
            try:
                with temporary.open("wb") as stream:
                    for chunk in response.iter_content(65536):
                        size += len(chunk)
                        if size > 25 * 1024 * 1024:
                            raise ValueError("Media exceeds desktop limit")
                        stream.write(chunk)
                temporary.replace(destination)
            finally:
                temporary.unlink(missing_ok=True)
                response.close()
        except (requests.RequestException, ValueError, OSError):
            missing.append(value)
    if on_progress:
        on_progress(len(paths), len(paths))
    return missing

import mimetypes
from pathlib import PurePosixPath

from django.core.exceptions import SuspiciousFileOperation
from django.core.files.storage import default_storage
from django.http import FileResponse, Http404
from django.views.decorators.http import require_safe


@require_safe
def media_file(request, path):
    if not path or path.startswith('/') or any(part in ('..', '.') or part.startswith('.') for part in PurePosixPath(path).parts):
        raise Http404
    try:
        file = default_storage.open(path, 'rb')
    except (FileNotFoundError, IsADirectoryError, SuspiciousFileOperation):
        raise Http404 from None
    response = FileResponse(file, content_type=mimetypes.guess_type(path)[0] or 'application/octet-stream')
    response['X-Content-Type-Options'] = 'nosniff'
    response['Cache-Control'] = 'public, max-age=3600'
    return response

from urllib.parse import quote

from storages.backends.s3 import S3Storage


class MediaS3Storage(S3Storage):
    """Browser URLs use the application proxy; S3 endpoints stay internal."""

    def url(self, name, parameters=None, expire=None, http_method=None):
        return '/media/' + quote(name.lstrip('/'), safe='/')

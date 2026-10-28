from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.test import override_settings

from apps.core.storage import MediaS3Storage


def test_s3_image_url_uses_public_application_path():
    storage = MediaS3Storage(endpoint_url='http://minio:9000', access_key='test', secret_key='test')
    assert storage.url('products/photo one.png') == '/media/products/photo%20one.png'


def test_media_proxy_reads_storage_and_rejects_missing_or_parent_paths(client, tmp_path):
    storage_settings = {
        'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage', 'OPTIONS': {'location': str(tmp_path)}},
        'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
    }
    with override_settings(STORAGES=storage_settings):
        default_storage.save('products/test.png', ContentFile(b'test-image'))
        result = client.get('/media/products/test.png')
        assert result.status_code == 200
        assert b''.join(result.streaming_content) == b'test-image'
        assert result['X-Content-Type-Options'] == 'nosniff'
        assert client.get('/media/products/missing.png').status_code == 404
        assert client.get('/media/../.env').status_code == 404

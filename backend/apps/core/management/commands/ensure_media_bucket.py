import time

from botocore.exceptions import ClientError, EndpointConnectionError
from django.conf import settings
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Create the configured private MinIO media bucket if it is missing.'

    def handle(self, *args, **options):
        if not settings.USE_MINIO:
            return
        client = default_storage.connection.meta.client
        bucket = settings.AWS_STORAGE_BUCKET_NAME
        for attempt in range(30):
            try:
                try:
                    client.head_bucket(Bucket=bucket)
                except ClientError as exc:
                    if exc.response['Error']['Code'] not in ('404', 'NoSuchBucket', 'NotFound'):
                        raise
                    client.create_bucket(Bucket=bucket)
                self.stdout.write(self.style.SUCCESS('Media bucket is ready.'))
                return
            except EndpointConnectionError:
                if attempt == 29:
                    raise CommandError('MinIO endpoint is unavailable.') from None
                time.sleep(2)

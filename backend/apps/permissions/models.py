from django.db import models

class Permission(models.Model):
    category = models.CharField(max_length=50)
    codename = models.CharField(max_length=255)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)

    class Meta:
        unique_together = ('category', 'codename')

    @property
    def full_code(self):
        return f"{self.category}.{self.codename}"

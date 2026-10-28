from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models
from ..managers import UserManager


class User(AbstractBaseUser, PermissionsMixin):
    ROLE_CHOICES = [
        ('staff', "Sotuvchi"),
        ('owner', "Do'kon egasi"),
        ('platform_admin', "Platforma administratori"),
    ]

    phone_number = models.CharField(max_length=20, unique=True, null=False, blank=False)
    contact_phone = models.CharField(
        max_length=20,
        blank=True,
        null=True,
        verbose_name="Doimiy aloqa raqami"
    )
    username = models.CharField(max_length=100, unique=True, null=True, blank=True, db_index=True)
    email = models.EmailField(null=True, blank=True)

    first_name = models.CharField(max_length=50, blank=True)
    last_name = models.CharField(max_length=50, blank=True)
    date_of_birth = models.DateField(blank=True, null=True)
    avatar = models.ImageField(upload_to="accounts/avatars/", null=True, blank=True)

    role = models.CharField(
        max_length=20, choices=ROLE_CHOICES
    )

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    is_phone_verified = models.BooleanField(default=False)
    profile_completed = models.BooleanField(default=False)
    terms_accepted = models.BooleanField(default=False)
    terms_accepted_at = models.DateTimeField(null=True, blank=True)
    terms_accepted_ip = models.CharField(max_length=45, null=True, blank=True)
    token_version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = UserManager()

    USERNAME_FIELD = 'phone_number'
    REQUIRED_FIELDS = ['username']

    def get_full_name(self):
        full_name = f"{self.first_name} {self.last_name}".strip()
        return full_name or self.username or self.phone_number

    def get_short_name(self):
        return self.first_name or self.username or self.phone_number

    def __str__(self):
        return self.username or self.phone_number

import warnings
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework import serializers

from apps.support.models import Conversation, Message


def validate_support_image(upload):
    if upload.size > 2 * 1024 * 1024:
        raise serializers.ValidationError("Image limit: 2 MB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(upload) as source:
                if source.format not in ("PNG", "JPEG", "WEBP") or source.width * source.height > 16_000_000:
                    raise ValueError
                source.load()
                image = ImageOps.exif_transpose(source).convert("RGB")
                image.thumbnail((1920, 1920))
                output = BytesIO()
                image.save(output, format="JPEG", quality=85)
                return output.getvalue()
    except (
        OSError,
        ValueError,
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise serializers.ValidationError("Use a valid PNG, JPEG or WebP image (up to 16 MP).") from exc


def validate_support_voice(upload):
    if upload.size > 10 * 1024 * 1024:
        raise serializers.ValidationError("Voice limit: 10 MB.")
    content_type = getattr(upload, "content_type", "")
    if content_type and not (content_type.startswith("audio/") or content_type in ("video/webm", "application/ogg")):
        raise serializers.ValidationError("Faqat audio fayllar ruxsat etiladi.")
    return upload.read()


class StartSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    subject = serializers.CharField(max_length=160)
    language = serializers.ChoiceField(choices=["uz", "ru", "en"], default="uz", required=False)
    text = serializers.CharField(max_length=4000, required=False, allow_blank=True, default="")
    client_id = serializers.UUIDField()
    consent = serializers.BooleanField()
    image = serializers.FileField(required=False)
    voice = serializers.FileField(required=False)
    voice_duration = serializers.IntegerField(required=False, default=0, min_value=0)
    sticker = serializers.CharField(required=False, allow_blank=True, max_length=100, default="")

    def validate_consent(self, value):
        if not value:
            raise serializers.ValidationError("Please accept the support privacy notice.")
        return value

    def validate_image(self, upload):
        return validate_support_image(upload)

    def validate_voice(self, upload):
        return validate_support_voice(upload)

    def validate(self, data):
        if not data.get("text") and not data.get("image") and not data.get("voice") and not data.get("sticker"):
            raise serializers.ValidationError("Xabar, rasm, ovozli xabar yoki stiker talab qilinadi.")
        return data


class SendSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=4000, required=False, allow_blank=True, default="")
    client_id = serializers.UUIDField()
    image = serializers.FileField(required=False)
    voice = serializers.FileField(required=False)
    voice_duration = serializers.IntegerField(required=False, default=0, min_value=0)
    sticker = serializers.CharField(required=False, allow_blank=True, max_length=100, default="")
    reply_to_id = serializers.IntegerField(required=False, allow_null=True)

    def validate_image(self, upload):
        return validate_support_image(upload)

    def validate_voice(self, upload):
        return validate_support_voice(upload)

    def validate(self, data):
        if not data.get("text") and not data.get("image") and not data.get("voice") and not data.get("sticker"):
            raise serializers.ValidationError("A message, image, voice or sticker is required.")
        return data


class ConversationSerializer(serializers.ModelSerializer):
    operator_name = serializers.SerializerMethodField()
    unread_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Conversation
        fields = [
            "id",
            "name",
            "subject",
            "language",
            "status",
            "operator_id",
            "operator_name",
            "tenant_id",
            "unread_count",
            "created_at",
            "updated_at",
        ]

    def get_operator_name(self, obj) -> str:
        return obj.operator.get_full_name() if obj.operator else ""


class ReplyPreviewSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            "id",
            "sender",
            "author_name",
            "text",
            "has_image",
            "has_voice",
            "voice_duration",
            "sticker",
        ]

    def get_author_name(self, obj) -> str:
        if obj.sender == "operator":
            return obj.author.get_full_name() if obj.author else "Operator"
        elif obj.sender == "visitor":
            return (
                obj.conversation.name
                if hasattr(obj, "conversation") and obj.conversation and obj.conversation.name
                else "Mijoz"
            )
        return "Tizim"


class MessageSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    reply_to = ReplyPreviewSerializer(read_only=True)

    class Meta:
        model = Message
        fields = [
            "id",
            "sender",
            "author_name",
            "client_id",
            "text",
            "event",
            "has_image",
            "has_voice",
            "voice_duration",
            "sticker",
            "reply_to",
            "created_at",
        ]

    def get_author_name(self, obj) -> str:
        return obj.author.get_full_name() if obj.author and obj.sender == "operator" else ""


class CustomerProfileSerializer(serializers.Serializer):
    is_registered = serializers.BooleanField()
    user = serializers.DictField(allow_null=True)
    guest = serializers.DictField(allow_null=True)
    tenant = serializers.DictField(allow_null=True)
    seller_profile = serializers.DictField(allow_null=True)
    stats = serializers.DictField()


class CustomerProfileUpdateSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=50, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=50, required=False, allow_blank=True)
    contact_phone = serializers.CharField(max_length=20, required=False, allow_blank=True, allow_null=True)
    tenant_name = serializers.CharField(max_length=100, required=False)
    tenant_address = serializers.CharField(max_length=255, required=False, allow_blank=True)

    def to_internal_value(self, data):
        from collections.abc import Mapping
        if isinstance(data, Mapping):
            unexpected = set(data) - set(self.fields)
            # The deployed legacy editor echoes read-only identity fields on
            # every contact save. Only the view supplies this trusted user;
            # request payloads must never supply or override this context.
            user = self.context.get('profile_user')
            ignored_echoes = set()
            if user is not None and set(data).intersection(self.fields):
                displayed_identity = {'email': user.email or '', 'role': user.role}
                ignored_echoes = {
                    key for key in unexpected.intersection(displayed_identity)
                    if isinstance(data[key], str) and data[key] == displayed_identity[key]
                }
                unexpected -= ignored_echoes
            if unexpected:
                raise serializers.ValidationError({key: 'Bu ma’lumotni yordam oynasidan o‘zgartirish mumkin emas. Himoyalangan hisob boshqaruvidan foydalaning.' for key in sorted(unexpected)})
            if ignored_echoes:
                data = {key: value for key, value in data.items() if key not in ignored_echoes}
        return super().to_internal_value(data)


class SupportMetadataSerializer(serializers.Serializer):
    phone = serializers.CharField()
    telegram_username = serializers.CharField()
    languages = serializers.ListField(child=serializers.CharField())
    ai_enabled = serializers.BooleanField()
    max_image_bytes = serializers.IntegerField()


class ConversationPageSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = ConversationSerializer(many=True)
    unread_total = serializers.IntegerField()


class MessagePageSerializer(serializers.Serializer):
    results = MessageSerializer(many=True)
    has_more = serializers.BooleanField()


import io
import os
from PIL import Image
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile

MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024  # 10 MB limit
MAX_DIMENSION = 1600  # Max width or height
DEFAULT_QUALITY = 90


def optimize_image(
    file_obj,
    max_dimension: int = MAX_DIMENSION,
    quality: int = DEFAULT_QUALITY,
    output_format: str = "WEBP",
) -> ContentFile:
    """
    Optimizes an uploaded image:
    1. Checks that file size does not exceed 10MB.
    2. Resizes proportionally if max(width, height) > max_dimension (1600px).
    3. Compresses to WebP (or JPEG) with quality=90.
    4. Returns a Django ContentFile with .webp extension.
    """
    if hasattr(file_obj, "size") and file_obj.size > MAX_IMAGE_FILE_SIZE:
        raise ValidationError(
            f"Rasm hajmi juda katta ({file_obj.size / (1024 * 1024):.1f}MB). Maksimal ruxsat etilgan hajm: 10MB."
        )

    try:
        file_obj.seek(0)
        img = Image.open(file_obj)
    except Exception as exc:
        raise ValidationError("Yaroqsiz rasm fayli.") from exc

    # Convert color mode for target format
    if output_format.upper() == "JPEG" and img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    elif output_format.upper() == "WEBP" and img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")

    # Resize proportionally if either dimension exceeds max_dimension
    if img.width > max_dimension or img.height > max_dimension:
        img.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)

    buffer = io.BytesIO()
    save_kwargs = {"quality": quality}
    if output_format.upper() == "WEBP":
        save_kwargs["method"] = 6
    img.save(buffer, format=output_format.upper(), **save_kwargs)
    buffer.seek(0)

    # Determine filename
    original_name = getattr(file_obj, "name", "image.webp")
    base_name, _ = os.path.splitext(original_name)
    ext = ".webp" if output_format.upper() == "WEBP" else ".jpg"
    new_filename = f"{base_name}{ext}"

    return ContentFile(buffer.getvalue(), name=new_filename)

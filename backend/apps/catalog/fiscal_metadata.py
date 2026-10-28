"""Optional catalog codes. Provider/catalog verification is a separate step."""

from django.core.exceptions import ValidationError
from django.core.validators import MaxLengthValidator, RegexValidator

validate_mxik = RegexValidator(r"\A[0-9]{17}\Z", "MXIK 17 ta raqamdan iborat bo‘lishi kerak.")
validate_package_code = RegexValidator(
    r"\A[^\s\x00-\x1f\x7f]+\Z", "Qadoq kodida bo‘sh joy yoki boshqaruv belgisi bo‘lmasligi kerak."
)


def clean_fiscal_metadata(*, mxik=None, package_code=None):
    result = {}
    for field, value, limit, validator in (
        ("mxik", mxik, 17, validate_mxik),
        ("package_code", package_code, 20, validate_package_code),
    ):
        if value is not None and not isinstance(value, str):
            raise ValidationError({field: "Kod matn ko‘rinishida yuborilishi kerak."})
        value = (value.strip() or None) if value is not None else None
        if value is not None:
            try:
                MaxLengthValidator(limit)(value)
                validator(value)
            except ValidationError as exc:
                raise ValidationError({field: exc.messages}) from exc
        result[field] = value
    return result

"""Transactional email with the ILBI logo embedded for offline image support."""
from email.message import MIMEPart
from pathlib import Path

from django.core.mail import EmailMultiAlternatives


def send_branded_email(*, subject, message, from_email, recipient_list, html_message, fail_silently=False):
    email = EmailMultiAlternatives(subject, message, from_email, recipient_list)
    email.attach_alternative(html_message, "text/html")
    logo = MIMEPart()
    logo.set_content(
        (Path(__file__).parent / "brand" / "ilbi-logo-email.png").read_bytes(),
        maintype="image", subtype="png", cid="<ilbi-logo>",
        disposition="inline", filename="ilbi-logo.png",
    )
    email.attach(logo)
    return email.send(fail_silently=fail_silently)

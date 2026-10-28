FROM python:3.12-slim AS application


RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*


COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/


WORKDIR /app


COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-install-project || uv sync --no-install-project


COPY . .

RUN uv sync --frozen


ENV PATH="/app/.venv/bin:$PATH"


RUN sed -i 's/\r$//' entrypoint.sh && chmod +x entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]


CMD ["gunicorn", "config.wsgi:application", "-c", "gunicorn.conf.py"]

FROM application AS production
RUN uv sync --frozen --no-dev \
    && useradd --uid 1000 --user-group --create-home --shell /usr/sbin/nologin ilbi \
    && mkdir -p /app/media /app/staticfiles /app/state \
    && chown ilbi:ilbi /app/media /app/staticfiles /app/state
ENV ILBI_SKIP_DEPENDENCY_SYNC=true PYTHONDONTWRITEBYTECODE=1 HOME=/home/ilbi
USER 1000:1000

# Preserve the development target as the default for docker-compose.yml.
FROM application AS development

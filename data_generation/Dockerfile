# Seeder image used by docker-compose (build context = repo root).
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY data_generation/requirements.txt data_generation/requirements.txt
RUN pip install --no-cache-dir -r data_generation/requirements.txt
COPY sql sql
COPY data_generation data_generation
COPY scripts scripts
CMD ["bash", "scripts/setup_db.sh"]

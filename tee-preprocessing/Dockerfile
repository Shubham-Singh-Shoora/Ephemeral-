FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install --requirement requirements.txt
COPY . ./
RUN python -m compileall -q .

USER 65532:65532
EXPOSE 8080
CMD ["uvicorn", "enclave_server:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]

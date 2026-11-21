FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PORT=8000 \
    SSL=0

WORKDIR /app

COPY server.py ./
COPY games/ ./games/
COPY static/ ./static/

EXPOSE 8000

CMD ["python", "-u", "server.py"]

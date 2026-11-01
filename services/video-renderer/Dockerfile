FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/video-renderer/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY scripts/render-video-assets.py /app/scripts/render-video-assets.py
COPY services/video-renderer/worker.py /app/services/video-renderer/worker.py
RUN useradd --system --create-home renderer && chown -R renderer:renderer /app
USER renderer
CMD ["python3", "services/video-renderer/worker.py"]

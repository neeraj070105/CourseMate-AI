# CourseMate AI - Root Dockerfile (Backend API Service)
# For running the multi-container application (Frontend + Backend + RAG Service),
# please use: docker compose up -d --build
FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/ ./

ENV PORT=5000

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:5000/api/health || exit 1

CMD ["node", "server.js"]

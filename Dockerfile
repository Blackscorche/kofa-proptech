# Kofa Proptech Deployment (Dockerfile for Railway & Docker)
# Zero external runtime dependencies: Node.js 22 alpine
FROM node:22-alpine

WORKDIR /app

# Copy application files
COPY package.json server.js ./
COPY src ./src
COPY css ./css
COPY js ./js
COPY images ./images
COPY admin ./admin
COPY agent ./agent
COPY landlord ./landlord
COPY tenant ./tenant
COPY *.html ./

# Railway persistent data volume support
ENV NODE_ENV=production \
    PORT=3000 \
    DB_FILE=/data/db.json \
    USSD_CODE=*555#

RUN mkdir -p /data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/api/config > /dev/null || exit 1

CMD ["node", "server.js"]

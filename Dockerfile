# =========================================
# Production image (Express API)
# =========================================
ARG NODE_VERSION=24.14.0-alpine

FROM node:${NODE_VERSION}

# Set the environment to production for express and smaller installs
ENV NODE_ENV=production

# Set the working directory inside the container
WORKDIR /app

# Copy package-related files first to leverage Docker's caching mechanism
COPY package.json package-lock.json ./

# Install production dependencies only (argon2 ships musl prebuilds, so no
# compiler toolchain is needed on alpine)
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# Copy the application source
COPY src ./src

# Run the container as a non-root user for security best practices
USER node

# Expose the API port (compose pins PORT=8000 inside the container)
EXPOSE 8000

# Liveness probe against the lightweight health route (no dependency checks)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT:-8000}/api/v1/health" || exit 1

# Config comes from the container environment (env_file in compose), not .env
CMD ["node", "src/index.js"]

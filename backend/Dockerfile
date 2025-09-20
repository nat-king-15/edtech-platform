# Backend Dockerfile for EdTech Platform

# Stage 1: Base image
FROM node:18-alpine AS base
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy package files
COPY package*.json ./

# Stage 2: Development dependencies
FROM base AS development
RUN npm ci
COPY . .
EXPOSE 5000
CMD ["dumb-init", "npm", "run", "dev"]

# Stage 3: Production dependencies
FROM base AS production-deps
RUN npm ci --omit=dev && npm cache clean --force

# Stage 4: Production build
FROM base AS production
ENV NODE_ENV=production

# Copy production dependencies
COPY --from=production-deps /app/node_modules ./node_modules

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Create directories for uploads and logs
RUN mkdir -p /app/uploads /app/logs && chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start the application
CMD ["dumb-init", "node", "server.js"]
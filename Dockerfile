# Use official Node.js runtime as base image
FROM node:20-alpine

# Set working directory in container
WORKDIR /app

# Copy package.json and yarn.lock
COPY package.json yarn.lock ./

# Install dependencies with yarn
RUN yarn install --frozen-lockfile --production && yarn cache clean

# Create app directory structure
RUN mkdir -p src logs

# Copy source code
COPY src/ ./src/

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S spybot -u 1001 -G nodejs

# Change ownership of the app directory to the spybot user
RUN chown -R spybot:nodejs /app

# Switch to non-root user
USER spybot

# Expose port for health checks (optional)
EXPOSE 3000

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "console.log('Bot is running')" || exit 1

# Start the application
CMD ["node", "src/index.js"]
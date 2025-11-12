# Use official Bun image
FROM oven/bun:latest

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Create data directory for persistent storage
RUN mkdir -p /app/data

# Expose callback port (if used)
EXPOSE 3000

# Run the application
CMD ["bun", "run", "index.ts"]


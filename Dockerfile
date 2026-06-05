# Use official Node.js LTS as build stage
FROM node:20-alpine AS builder
WORKDIR /app
# Install dependencies based on package-lock for reproducibility
COPY package*.json ./
RUN npm install --omit=dev
# Copy source code
COPY . ./
# Production stage
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .
# Expose backend port (default 5000)
EXPOSE 5000
# Start server
CMD ["node", "server.js"]

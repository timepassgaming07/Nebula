FROM node:20-alpine

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy source code
COPY src/ ./src/

# Railway/Render set PORT dynamically
ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "src/index.js"]

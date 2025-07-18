# Use the official lightweight Node.js 22 image
FROM node:22-alpine

# Where all app code will live inside the container
WORKDIR /app

# Copy only the dependency manifest first for better layer-caching
COPY package*.json ./
# Copy dashboard package manifests for layer caching
COPY dashboard/package*.json ./dashboard/

# Install root and dashboard dependencies for optimal caching
RUN npm ci --legacy-peer-deps \
    && npm --prefix dashboard ci --legacy-peer-deps

# Copy the rest of the source code
COPY . .

# Build Prisma Client and application
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL
# Ensure production environment for optimized builds
ENV NODE_ENV=production
# Generate Prisma clients for both root and dashboard, then build
RUN npx prisma generate \
    && npm --prefix dashboard run prisma:generate \
    && npm run build

# Expose application port (Render will set PORT env variable)
EXPOSE 3000

# Start the production server
CMD ["npm", "start"] 
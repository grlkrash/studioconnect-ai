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

# Build Prisma Client (needs DATABASE_URL)
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL
RUN npx prisma generate

# Expose Next.js default port
EXPOSE 3000
# Expose Next.js dashboard port as well
EXPOSE 3100

# Run the dev server (change to "start" if you build for prod)
CMD ["npm", "run", "dev"] 
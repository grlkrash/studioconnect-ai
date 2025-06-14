# Use the official lightweight Node.js 22 image
FROM node:22-alpine

# Where all app code will live inside the container
WORKDIR /app

# Copy only the dependency manifest first for better layer-caching
COPY package*.json ./

# Install all dependencies exactly as locked
# --legacy-peer-deps avoids peer-dependency conflicts in dev
RUN npm ci --legacy-peer-deps

# Copy the rest of the source code
COPY . .

# Build Prisma Client (needs DATABASE_URL)
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL
RUN npx prisma generate

# Expose Next.js default port
EXPOSE 3000

# Run the dev server (change to "start" if you build for prod)
CMD ["npm", "run", "dev"] 
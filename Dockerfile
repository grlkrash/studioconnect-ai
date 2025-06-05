# ---- Builder Stage ----
# This stage installs all dependencies (including devDependencies)
# and builds your TypeScript code to JavaScript.
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Install system dependencies that might be needed by node-gyp for some packages
RUN apk add --no-cache libc6-compat openssl python3 make g++

# Copy package manifests
COPY package.json yarn.lock ./

# Install ALL dependencies (including devDependencies needed for `prisma generate` and `tsc`)
RUN yarn install --frozen-lockfile --network-timeout 100000

# Copy the Prisma schema
COPY prisma ./prisma/

# Copy the rest of the application source code
COPY . .

# Run the build script (prisma generate && tsc)
# This will compile TypeScript to JavaScript in the /dist folder
# and ensure Prisma Client is generated for the correct binaryTargets.
RUN yarn build

# ---- Production Stage ----
# This stage creates the final, smaller image with only production dependencies
# and the compiled JavaScript code.
FROM node:20-alpine AS production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /usr/src/app

# Install only necessary production system dependencies
RUN apk add --no-cache libc6-compat openssl

# Copy package manifests
COPY package.json yarn.lock ./

# Install ONLY production dependencies
RUN yarn install --production --frozen-lockfile --network-timeout 100000

# Copy compiled code from the builder stage
COPY --from=builder /usr/src/app/dist ./dist

# Copy Prisma schema (may be needed by Prisma Client at runtime for some operations or for migrate deploy)
COPY --from=builder /usr/src/app/prisma ./prisma

# Copy the generated Prisma Client from the builder stage to the production node_modules
# This ensures the client with the correct binary engine is available
COPY --from=builder /usr/src/app/node_modules/.prisma/client ./node_modules/.prisma/client

# Copy public assets and EJS views FROM THE BUILDER STAGE'S SOURCE
COPY --from=builder /usr/src/app/src/public ./public
COPY --from=builder /usr/src/app/src/views ./views

# Your application listens on port 3000 (or a PORT from .env)
EXPOSE ${PORT:-3000}

# The command to run your compiled application
# This uses the "start" script from package.json: "node dist/server.js"
CMD ["yarn", "start"] 
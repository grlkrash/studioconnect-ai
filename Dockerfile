# ---- Builder Stage ----
# This stage installs all dependencies (including devDependencies)
# and builds your TypeScript code to JavaScript.
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Install system dependencies that might be needed by node-gyp for some packages
RUN apk add --no-cache libc6-compat openssl python3 make g++

# Copy package manifests and install dependencies
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false --network-timeout 100000

# Copy entire project context
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the application
RUN yarn build
RUN yarn tailwind:build

# ---- Production Stage ----
# This stage creates the final, smaller image with only production dependencies
# and the compiled JavaScript code.
FROM node:20-alpine AS production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}
ENV PATH="/usr/local/share/.config/yarn/global/node_modules/.bin:${PATH}"

WORKDIR /usr/src/app

# Install only necessary production system dependencies
RUN apk add --no-cache libc6-compat openssl

# Install nodemon globally
RUN yarn global add nodemon

# Copy package manifests
COPY package.json yarn.lock ./

# Install ONLY production dependencies
RUN yarn install --production --frozen-lockfile --network-timeout 100000

# Copy necessary files from builder
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/prisma ./prisma
COPY --from=builder /usr/src/app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /usr/src/app/node_modules/@prisma ./node_modules/@prisma

# Copy public assets and EJS views FROM THE BUILDER STAGE'S SOURCE
COPY --from=builder /usr/src/app/src/public ./public
COPY --from=builder /usr/src/app/src/views ./views

# Your application listens on port 3000 (or a PORT from .env)
EXPOSE ${PORT:-3000}

# The command to run your compiled application
# This uses the "start" script from package.json: "node dist/server.js"
CMD ["yarn", "start"] 
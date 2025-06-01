# Use an official Node.js LTS Alpine image as a parent image for a smaller size
FROM node:20-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Install system dependencies needed for some Node.js packages (like Prisma)
# libc6-compat is for Prisma on Alpine.
# python3, make, g++ are common build tools for node-gyp if any packages compile native addons.
RUN apk add --no-cache libc6-compat openssl python3 make g++

# Copy package.json and yarn.lock to leverage Docker cache
# We're using yarn because it was more stable for your environment
COPY package.json yarn.lock ./

# Install app dependencies using yarn
# --frozen-lockfile ensures it uses yarn.lock and doesn't try to update it
# Increased network timeout for potentially slow connections
RUN yarn install --frozen-lockfile --network-timeout 100000

# Copy the Prisma schema file(s)
COPY prisma ./prisma/

# Generate Prisma Client inside the Docker image
# This ensures the client is built for the container's environment (Linux Alpine)
RUN yarn prisma generate

# Copy the rest of your application's source code into the image
# For development, much of this will be overridden by a volume mount
# specified in docker-compose.yml, but this is good for building a standalone image.
COPY . .

# Your application listens on port 3000 (or a PORT from .env)
# This line informs Docker that the container listens on this port
EXPOSE 3000

# The command to run your application in development mode
# This will be the default command if not overridden by docker-compose.yml
CMD ["yarn", "dev"] 
# Stage 1: Build dependencies
FROM node:20-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install

# Stage 2: Runtime image
FROM node:20-alpine
WORKDIR /usr/src/app
# Copy installed node_modules (including dev dependencies for testing)
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY . .

EXPOSE 8080
CMD ["npm", "start"]

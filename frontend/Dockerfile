# Use the official Node.js image as the base
FROM node:18-alpine AS builder

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .
COPY .env .env

# Build the Next.js application
RUN npm run build

# ---------------------
# Production Stage
# ---------------------
FROM node:18-alpine AS runner

# Set the working directory inside the container
WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy built application from the builder stage
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Expose the port the app will run on
EXPOSE 3000

# Start the Next.js application
CMD ["npm", "start"]

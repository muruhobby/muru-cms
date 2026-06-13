# syntax=docker/dockerfile:1

# Full Debian-based image (not -slim) so native modules such as @swc/core and
# sharp have python3/make/g++ available to compile during `npm ci`.
FROM node:22-bookworm

WORKDIR /app

# 1. Dependencies in their own layer.
#    This layer is only rebuilt when package.json / package-lock.json change,
#    so routine code deploys reuse the cache and skip the ~19-minute install
#    that was tripping Railway's build deadline. NODE_ENV is left unset here on
#    purpose: `medusa build` needs the devDependencies (vite, typescript, swc).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 2. Copy source and build the server + admin UI into .medusa/server.
COPY . .
RUN npm run build

# 3. Runtime config (applies only to the running container, not the build).
ENV NODE_ENV=production
EXPOSE 9000

# Default command. On Railway, DB setup (migrate/bootstrap/seed) runs via the
# preDeployCommand in railway.toml; this just starts the server. The CMD is a
# sensible fallback for running the image outside Railway.
CMD ["npm", "run", "start:prod"]

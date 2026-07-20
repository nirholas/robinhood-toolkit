# robinhood-toolkit · container image for Google Cloud Run and Railway
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: MIT (c) 2026 nirholas
#
# Build:  docker build -t robinhood-toolkit-site site
# Run:    docker run -p 8080:8080 robinhood-toolkit-site
#
# The runtime stage carries no node_modules: the site is static after the build,
# and scripts/serve.mjs has zero dependencies.

FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# SITE_BASE stays "/" here. Only GitHub Pages project sites need a path prefix.
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/serve.mjs ./scripts/serve.mjs
EXPOSE 8080
CMD ["node", "scripts/serve.mjs"]

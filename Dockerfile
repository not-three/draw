FROM node:25-alpine AS build-stage

WORKDIR /app
RUN npm i -g pnpm
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
RUN pnpm install
COPY . .
RUN pnpm build

FROM httpd:2

COPY --from=build-stage /app/dist /usr/local/apache2/htdocs

EXPOSE 80
LABEL org.opencontainers.image.source=https://github.com/not-three/draw
LABEL org.opencontainers.image.title="not-th.re/draw"
LABEL org.opencontainers.image.description="!3 is a simple, secure and open source paste sharing platform."
LABEL org.opencontainers.image.authors="Joschua Becker EDV <support@scolasti.co>"

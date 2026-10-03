# Build context: ../frontend (see docker-compose.yml). nginx.conf arrives as the named context "nginxconf".
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Vite inlines VITE_* at build time: http = real backend calls (fixture = scripted mocks).
ARG VITE_API_SOURCE=http
ARG VITE_API_BASE_URL=/api
ENV VITE_API_SOURCE=$VITE_API_SOURCE VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=nginxconf nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

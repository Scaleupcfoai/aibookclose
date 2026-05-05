FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine

RUN rm /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf.template
COPY start.sh /start.sh
RUN chmod +x /start.sh

ENV PORT=80
ENV BACKEND_URL=https://aitdsrecon-production-9fb5.up.railway.app

CMD ["/start.sh"]

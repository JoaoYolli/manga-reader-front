FROM node:20-alpine

WORKDIR /app

COPY . .

RUN npm install http-server -g

EXPOSE 8036

CMD ["http-server", "-p", "8036"]

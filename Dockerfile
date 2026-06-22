FROM oven/bun:latest
WORKDIR /app
COPY package.json server.ts ./
COPY public ./public
EXPOSE 3000
CMD ["bun", "run", "server.ts"]

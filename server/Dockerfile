FROM node:24-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY server/migrations ./migrations
USER node
EXPOSE 3001
CMD ["sh", "-c", "npm run db:migrate && npm start"]

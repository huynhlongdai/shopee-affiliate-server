FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Install Chromium matching the installed playwright version + all system deps
RUN npx playwright install --with-deps chromium

COPY . .

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]

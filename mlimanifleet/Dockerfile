FROM node:20-alpine
WORKDIR /app
COPY package.json ./
# Optional: npm install pg for PostgreSQL
RUN npm install --omit=dev pg 2>/dev/null || true
COPY . .
ENV PORT=3847
ENV PAYMENT_DEMO=true
ENV NOTIFY_DEMO=true
EXPOSE 3847
CMD ["node", "server/index.js"]

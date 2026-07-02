FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
ENV PORT=4444
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 4444
CMD ["node", "src/server.js"]

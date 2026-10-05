FROM node:26-alpine AS build
ARG VITE_BASE_PATH=/
ARG VITE_PIX_KEY=
ENV VITE_BASE_PATH=$VITE_BASE_PATH
ENV VITE_PIX_KEY=$VITE_PIX_KEY
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
EXPOSE 3000
CMD ["npm", "start"]

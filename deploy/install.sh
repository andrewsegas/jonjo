#!/usr/bin/env sh
set -eu

install_dir=/docker/sala
cd "$install_dir"
umask 077

if [ ! -s .env ] || ! grep -q '^LIVEKIT_API_KEY=' .env || ! grep -q '^LIVEKIT_API_SECRET=' .env; then
  api_key="sala_$(openssl rand -hex 8)"
  api_secret="$(openssl rand -hex 32)"
  printf 'PORT=3000\nROOM_NAME=geral\nLIVEKIT_API_KEY=%s\nLIVEKIT_API_SECRET=%s\nPUBLIC_LIVEKIT_URL=wss://jonjo.live\nLIVEKIT_INTERNAL_URL=http://sala-livekit:7880\nCHANNELS_FILE=/data/channels.json\n' \
    "$api_key" "$api_secret" > .env
fi

grep -q '^LIVEKIT_INTERNAL_URL=' .env || printf 'LIVEKIT_INTERNAL_URL=http://sala-livekit:7880\n' >> .env
grep -q '^CHANNELS_FILE=' .env || printf 'CHANNELS_FILE=/data/channels.json\n' >> .env

set -a
. ./.env
set +a

cat > livekit.runtime.yaml <<EOF
port: 7880
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: true
logging:
  level: info
keys:
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
EOF
chmod 600 .env livekit.runtime.yaml

docker compose -f docker-compose.yml -f docker-compose.pzaas.yml up -d --build

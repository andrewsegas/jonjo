#!/usr/bin/env sh
# Migração pzaas.online/sala  ->  jonjo.live (raiz).
# Rode na VPS, dentro de /docker/sala, DEPOIS que o código atualizado já estiver
# nesta máquina (git pull ou cópia) e que o DNS de jonjo.live já aponte para cá.
set -eu

install_dir=/docker/sala
cd "$install_dir"

echo "==> 1/5 Atualizando PUBLIC_LIVEKIT_URL no .env"
if grep -q '^PUBLIC_LIVEKIT_URL=' .env; then
  sed -i 's|^PUBLIC_LIVEKIT_URL=.*|PUBLIC_LIVEKIT_URL=wss://jonjo.live|' .env
else
  printf 'PUBLIC_LIVEKIT_URL=wss://jonjo.live\n' >> .env
fi
grep '^PUBLIC_LIVEKIT_URL=' .env

echo "==> 2/5 Removendo o bloco /sala antigo do Caddyfile do n8n (com backup)"
python3 deploy/remove-old-sala.py

echo "==> 3/5 Adicionando o bloco jonjo.live ao Caddyfile do n8n (com backup)"
python3 deploy/patch-caddy.py

echo "==> 4/5 Recarregando o Caddy"
# Descubra o nome do container do Caddy com: docker ps --format '{{.Names}}'
# Ajuste CADDY_CONTAINER abaixo se necessário (padrão comum: caddy).
CADDY_CONTAINER="${CADDY_CONTAINER:-caddy}"
if docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile 2>/dev/null; then
  echo "Caddy recarregado."
else
  echo "Nao recarreguei automaticamente. Rode manualmente, por exemplo:"
  echo "  docker exec <container-do-caddy> caddy reload --config /etc/caddy/Caddyfile"
  echo "  (ou reinicie o container do Caddy)"
fi

echo "==> 5/5 Rebuild e subida da aplicacao Jonjo"
docker compose -f docker-compose.yml -f docker-compose.pzaas.yml up -d --build

echo "==> Pronto. Teste: https://jonjo.live/"
echo "    O primeiro acesso pode levar alguns segundos enquanto o Caddy emite o certificado."

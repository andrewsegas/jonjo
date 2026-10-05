# Deploy em produção

Este guia descreve como colocar o Jonjo no ar numa VPS com Docker. Para rodar
na sua máquina, use o [passo a passo do README](../README.md#como-rodar-localmente-passo-a-passo).

> **Regra de ouro:** gere segredos novos para cada instalação e mantenha-os
> **somente** no servidor (`.env` e `livekit.runtime.yaml`). Nunca os comite.

## 1. Requisitos

- VPS Linux com Docker e Docker Compose.
- Um domínio apontando (DNS tipo A) para o IP da VPS.
- Um proxy HTTPS (Caddy ou Nginx). **HTTPS é obrigatório**: fora de `localhost`
  o navegador não libera microfone nem compartilhamento de tela sem ele.

## 2. Firewall

Abra na VPS:

| Porta | Protocolo | Uso |
|---|---|---|
| `80`, `443` | TCP | Proxy HTTPS (normalmente já abertas) |
| `7881` | TCP | Fallback WebRTC do LiveKit |
| `7882` | UDP | Mídia WebRTC do LiveKit |

As portas `3000` (app) e `7880` (API/WebSocket do LiveKit) ficam presas em
`127.0.0.1` e só são acessadas pelo proxy.

## 3. Segredos

Gere uma chave curta e um segredo longo para o LiveKit, e um segredo de sessão:

```bash
echo "LIVEKIT_API_KEY=sala_$(openssl rand -hex 8)"
echo "LIVEKIT_API_SECRET=$(openssl rand -hex 32)"
echo "SESSION_SECRET=$(openssl rand -hex 32)"
```

Crie o `.env` a partir do `.env.example` e ajuste para produção:

```dotenv
PORT=3000
ROOM_NAME=geral
LIVEKIT_API_KEY=<gerado>
LIVEKIT_API_SECRET=<gerado>
PUBLIC_LIVEKIT_URL=wss://seu-dominio.com
LIVEKIT_INTERNAL_URL=http://livekit:7880
CHANNELS_FILE=/data/channels.json
SERVERS_FILE=/data/servers.json
USERS_FILE=/data/users.json
SESSION_SECRET=<gerado>
PRESIDENT_USERNAME=seu_usuario
VITE_PIX_KEY=
```

Coloque **os mesmos** `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` na seção `keys:` do
arquivo de config do LiveKit e proteja os arquivos:

```bash
chmod 600 .env livekit.yaml
```

> Defina `PRESIDENT_USERNAME` **antes** de abrir o site. Se ficar vazio, o
> primeiro visitante a se cadastrar vira presidente.

## 4. Opção A — Nginx

Suba os serviços:

```bash
docker compose up -d --build
```

O SDK do LiveKit conecta pelo caminho `/rtc`. Encaminhe esse caminho ao
LiveKit e o restante à aplicação:

```nginx
server {
    server_name seu-dominio.com;

    location /rtc {
        proxy_pass http://127.0.0.1:7880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    listen 443 ssl;
    # Configure aqui o certificado (ex.: Certbot / Let's Encrypt).
}
```

## 5. Opção B — Caddy compartilhado (deploy de referência)

A pasta [`deploy/`](../deploy) contém os scripts usados na instância de
referência, onde o Jonjo divide um Caddy já existente (de um stack n8n) via a
rede Docker externa `n8n_default`. Adapte caminhos, domínio e nomes de rede ao
seu ambiente antes de usar.

| Arquivo | Função |
|---|---|
| `deploy/install.sh` | Gera `.env` e `livekit.runtime.yaml` com segredos aleatórios (se ainda não existirem) e sobe os containers |
| `deploy/Caddyfile.sala` | Bloco de site do Caddy: `/rtc*` → LiveKit, resto → app |
| `deploy/patch-caddy.py` | Anexa o bloco ao Caddyfile existente, com backup |
| `deploy/remove-old-sala.py` | Remove a rota antiga `/sala` (migração), com backup |
| `deploy/migrate-jonjo.sh` | Roteiro da migração de subcaminho para domínio próprio |
| `docker-compose.pzaas.yml` | Override que conecta os containers à rede do Caddy |

```bash
sh deploy/install.sh
```

> ⚠️ O `install.sh` gera só as variáveis do LiveKit e `CHANNELS_FILE`. Antes de
> rodá-lo pela primeira vez, acrescente ao `.env` `SESSION_SECRET` (sem ele, o
> login fica desativado), `PRESIDENT_USERNAME`, e `USERS_FILE=/data/users.json` e
> `SERVERS_FILE=/data/servers.json` (sem eles, usuários e servidores ficam dentro
> do container e somem a cada rebuild).

O Caddy emite o certificado TLS automaticamente quando o DNS do domínio aponta
para a VPS e as portas 80/443 estão acessíveis.

## 6. Widget de apoio (PIX)

O widget "Apoie o Jonjo" só aparece se `VITE_PIX_KEY` estiver definida **no
momento do build** (é uma variável do Vite, embutida no JavaScript). No deploy
com `docker-compose.pzaas.yml`, ela é lida do `.env` e passada como build arg.
Depois de alterá-la, refaça o build: `docker compose ... up -d --build`.

## 7. Backup dos dados

Usuários (com hash de senha), servidores e canais ficam no volume `jonjo_data`
(`/data` no container). Faça backup periódico:

```bash
docker run --rm -v jonjo_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/jonjo-data-$(date +%F).tgz -C /data .
```

O nome real do volume inclui o prefixo do projeto Compose; confira com
`docker volume ls`. Esses backups contêm dados de usuários: guarde-os fora do
repositório e com acesso restrito.

## Limitação conhecida

A configuração usa UDP direto com fallback TCP, sem TURN/TLS dedicado. Isso
basta para a maioria das redes domésticas. Em redes corporativas ou de
universidades muito restritivas, alguns participantes podem não conectar; o
próximo passo é habilitar o TURN embutido do LiveKit ou um coturn.

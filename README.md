# Jonjo

Jonjo é uma sala de **voz e compartilhamento de tela no navegador**, pensada para
pequenos grupos. O cliente é React; a mídia passa pelo [LiveKit](https://livekit.io)
(um SFU WebRTC open source); o servidor é um Express pequeno que cuida de login,
servidores, canais e emissão de tokens.

Este é um projeto **open source e educacional**: alunos da universidade são
convidados a estudar, corrigir e evoluir o código. Se é sua primeira vez
contribuindo com open source, comece pelo [CONTRIBUTING.md](./CONTRIBUTING.md).

**Recursos atuais:** cadastro e login, servidores (com senha opcional), canais
com limite de pessoas, voz com cancelamento de eco/ruído do navegador, mute,
seleção de microfone, indicador de fala, reconexão, compartilhamento de tela
(com áudio opcional da aba) em três qualidades, e cargos (`presidente`, `rico`,
`pobre`) que controlam quem cria servidores e qual qualidade de tela pode usar.

---

## Sumário

- [Como funciona](#como-funciona)
- [Como rodar localmente (passo a passo)](#como-rodar-localmente-passo-a-passo)
- [Testando com mais de uma pessoa](#testando-com-mais-de-uma-pessoa)
- [Problemas comuns](#problemas-comuns)
- [Scripts disponíveis](#scripts-disponíveis)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Deploy](#deploy)
- [Como contribuir](#como-contribuir)
- [Segurança](#segurança)
- [Licença](#licença)

---

## Como funciona

```
 Navegador (React + livekit-client)
    │                          │
    │ HTTP /api/*              │ WebSocket /rtc  +  mídia WebRTC (UDP 7882 / TCP 7881)
    ▼                          ▼
 Servidor Express  ───────►  LiveKit (SFU)
 (server/index.mjs)  cria salas / conta participantes
    │
    ▼
 data/*.json  (usuários, servidores, canais)
```

1. O usuário se cadastra ou faz login. O servidor guarda a senha com **scrypt +
   salt** e devolve um **cookie de sessão assinado (HMAC)**.
2. Para entrar num canal, o cliente chama `POST /api/token`. O servidor confere
   a sessão, a senha do servidor (se houver) e a lotação do canal, e então emite
   um **token JWT do LiveKit** válido só para aquela sala.
3. O navegador usa esse token para se conectar direto ao LiveKit, que distribui
   o áudio e o vídeo entre os participantes.

Não há banco de dados: os dados ficam em arquivos JSON (por padrão em `./data/`,
que é ignorado pelo git).

---

## Como rodar localmente (passo a passo)

### 1. Pré-requisitos

| Ferramenta | Versão | Para quê |
|---|---|---|
| [Node.js](https://nodejs.org) | **22 ou superior** | rodar o frontend e a API |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) (ou Docker Engine) | recente | rodar o servidor de mídia LiveKit |
| [Git](https://git-scm.com) | qualquer | clonar o repositório |
| Navegador | Chrome, Edge ou Firefox atual | testar |

Confira as versões no terminal:

```bash
node -v      # deve mostrar v22.x ou maior
docker -v
git --version
```

> **Windows:** abra o Docker Desktop e espere ele ficar "running" antes do
> passo 4. Os comandos abaixo funcionam no PowerShell, no Git Bash e no terminal
> do VS Code.

### 2. Clone o repositório

Se você vai contribuir, primeiro faça um **fork** (veja o
[CONTRIBUTING.md](./CONTRIBUTING.md)) e clone o seu fork:

```bash
git clone https://github.com/SEU-USUARIO/jonjo.git
cd jonjo
```

### 3. Crie o arquivo `.env`

```bash
# macOS / Linux / Git Bash
cp .env.example .env

# PowerShell
Copy-Item .env.example .env
```

Os valores do `.env.example` **já funcionam localmente** — não precisa mudar
nada. A chave e o segredo do LiveKit nele são os mesmos de `livekit.dev.yaml`.

### 4. Suba o LiveKit (servidor de mídia)

```bash
npm run livekit:up
```

Isso roda `docker compose` com o override `docker-compose.dev.yml`, que sobe
**só** o LiveKit e o configura para anunciar `127.0.0.1`. Confira se está de pé:

```bash
npm run livekit:logs    # Ctrl+C para sair dos logs
```

Os logs devem mostrar o LiveKit iniciando na porta `7880`, sem erros de configuração.

### 5. Instale as dependências

```bash
npm install
```

### 6. Rode a aplicação

```bash
npm run dev
```

Esse comando sobe **dois processos** ao mesmo tempo:

- **Vite** (frontend com hot reload) em `http://localhost:5173`;
- **API Express** em `http://localhost:3000` (reinicia sozinha ao salvar
  `server/index.mjs`).

O Vite repassa as chamadas `/api` para a porta 3000, então você só precisa abrir
uma URL.

### 7. Teste no navegador

1. Abra **http://localhost:5173**.
2. Clique em **"Não tenho acesso — criar um"** e cadastre um usuário (mínimo 3
   caracteres no usuário e 6 na senha). **O primeiro cadastro vira
   `presidente`** (admin).
3. Entre no servidor **Jonjo** e no canal **Geral**.
4. Autorize o microfone quando o navegador pedir.
5. Teste mute, troca de microfone e compartilhamento de tela.

> `localhost` pode usar microfone e tela **sem HTTPS**. Qualquer outro endereço
> (inclusive o IP da sua máquina na rede) exige HTTPS.

### 8. Rode as verificações

Antes de abrir um Pull Request, tudo isto precisa passar:

```bash
npm run check   # TypeScript
npm test        # testes unitários (node --test)
npm run build   # build de produção
```

### 9. Para desligar

```bash
# Ctrl+C no terminal do npm run dev, e depois:
npm run livekit:down
```

Para começar do zero (apagar usuários, servidores e canais locais), apague a
pasta `data/`.

---

## Testando com mais de uma pessoa

- **Na mesma máquina:** abra uma segunda janela **anônima** (ou outro navegador),
  crie outro usuário e entre no mesmo canal. Use fones para evitar microfonia.
- **Promover um usuário:** logado como `presidente`, clique em **Gerenciar
  usuários** e mude o cargo de outro usuário para `rico` (pode criar servidores
  e usar todas as qualidades de tela).
- **Outras máquinas da rede:** exigem HTTPS e ajuste do `--node-ip` para o IP da
  sua máquina. Para isso, o mais simples é usar um túnel HTTPS ou seguir o
  [guia de deploy](./docs/DEPLOY.md).

---

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `open //./pipe/dockerDesktopLinuxEngine` ou `Cannot connect to the Docker daemon` | Docker não está rodando | Abra o Docker Desktop e espere iniciar. |
| `port is already allocated` (7880, 7881 ou 7882) | Outro LiveKit ou programa usando a porta | `docker ps` para achar o container e pará-lo. |
| "O Jonjo ainda está arrumando os cadeados." | `SESSION_SECRET` ausente no `.env` | Copie de novo o `.env.example`. |
| "O Jonjo ainda está arrumando os cabos." | Variáveis do LiveKit ausentes no `.env` | Confira `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` e `PUBLIC_LIVEKIT_URL`. |
| "O Jonjo não conseguiu conferir se ainda cabe gente nesse canal." | API não alcança o LiveKit | LiveKit está de pé? `LIVEKIT_INTERNAL_URL` deve ser `http://localhost:7880`. |
| Entra no canal mas fica "conectando" ou sem áudio | Chave/segredo diferentes, ou portas bloqueadas | `.env` e `livekit.dev.yaml` precisam ter a mesma chave/segredo. Veja `npm run livekit:logs`. |
| Microfone não é pedido / erro de permissão | Página não está em `localhost` nem HTTPS | Use `http://localhost:5173`. |
| `node: bad option: --env-file-if-exists` | Node antigo | Instale o Node 22+. |

---

## Scripts disponíveis

| Script | O que faz |
|---|---|
| `npm run dev` | Frontend (Vite, porta 5173) + API (porta 3000) com recarregamento |
| `npm run build` | Typecheck + build de produção em `dist/` |
| `npm start` | Sobe a API servindo o `dist/` (modo produção) |
| `npm run check` | Typecheck do frontend |
| `npm test` | Testes unitários com o runner nativo do Node |
| `npm run livekit:up` | Sobe o LiveKit local no Docker |
| `npm run livekit:logs` | Acompanha os logs do LiveKit |
| `npm run livekit:down` | Derruba os containers locais |

---

## Estrutura do projeto

```
.
├── src/                    # Frontend React
│   ├── App.tsx             # Telas: login, lobby de servidores, sala, admin
│   ├── sounds.ts           # Efeitos sonoros
│   └── styles.css
├── server/
│   ├── index.mjs           # API Express: auth, servidores, canais, tokens
│   └── index.test.mjs      # Testes unitários
├── public/                 # Arquivos estáticos (favicon, áudios)
├── deploy/                 # Scripts do deploy de referência (VPS com Caddy)
├── docs/                   # Documentação extra (deploy, como abrir issue)
├── .github/                # Templates de issue/PR e CI
├── docker-compose.yml      # App + LiveKit (base)
├── docker-compose.dev.yml  # Override: só LiveKit, para desenvolvimento local
├── livekit.dev.yaml        # Config do LiveKit para desenvolvimento local
├── livekit.yaml            # Modelo de config do LiveKit para produção
└── .env.example            # Modelo de variáveis de ambiente
```

---

## Variáveis de ambiente

Todas estão documentadas, com comentários, no [`.env.example`](./.env.example).
Resumo:

| Variável | Obrigatória | Descrição |
|---|---|---|
| `PORT` | não | Porta da API (padrão `3000`) |
| `ROOM_NAME` | não | ID do canal padrão (padrão `geral`) |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | sim | Credenciais do LiveKit; iguais às do arquivo de config do LiveKit |
| `PUBLIC_LIVEKIT_URL` | sim | URL do LiveKit vista pelo navegador (`ws://` local, `wss://` produção) |
| `LIVEKIT_INTERNAL_URL` | recomendada | URL do LiveKit vista pela API; habilita contagem de pessoas e limite por canal |
| `SESSION_SECRET` | sim | Segredo que assina os cookies de sessão |
| `PRESIDENT_USERNAME` | não | Usuário que vira presidente ao se cadastrar |
| `USERS_FILE` / `SERVERS_FILE` / `CHANNELS_FILE` | não | Onde salvar os dados (padrão `./data/`) |
| `VITE_PIX_KEY` | não | Chave PIX do widget de apoio; vazia = widget oculto |

> **Nunca comite o `.env`.** Ele já está no `.gitignore`.

---

## Deploy

O guia de produção (Docker Compose, Caddy ou Nginx, portas de firewall e
geração de segredos) está em [docs/DEPLOY.md](./docs/DEPLOY.md).

---

## Como contribuir

1. Leia o [CONTRIBUTING.md](./CONTRIBUTING.md) e o
   [Código de Conduta](./CODE_OF_CONDUCT.md).
2. Encontrou um bug ou tem uma ideia? Veja
   [como abrir uma issue](./docs/COMO-ABRIR-ISSUE.md).
3. Procure issues marcadas com **`good first issue`** para começar.

---

## Segurança

Encontrou uma vulnerabilidade? **Não abra issue pública.** Siga a
[Política de Segurança](./SECURITY.md).

---

## Licença

Distribuído sob a licença **MIT**. Veja [LICENSE](./LICENSE).

O LiveKit e as demais dependências têm suas próprias licenças, listadas nos
respectivos pacotes.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

const app = express();
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;
const publicLiveKitUrl = process.env.PUBLIC_LIVEKIT_URL;
const internalLiveKitUrl = process.env.LIVEKIT_INTERNAL_URL;
const channelsFile = process.env.CHANNELS_FILE || path.join(rootDir, 'data', 'channels.json');
const serversFile = process.env.SERVERS_FILE || path.join(rootDir, 'data', 'servers.json');
const usersFile = process.env.USERS_FILE || path.join(rootDir, 'data', 'users.json');
const sessionSecret = process.env.SESSION_SECRET;
const presidentUsername = normalizeUsername(process.env.PRESIDENT_USERNAME || '');
const defaultChannel = { id: process.env.ROOM_NAME || 'geral', name: 'Geral' };
const defaultServer = { id: process.env.DEFAULT_SERVER_ID || 'jonjo', name: process.env.DEFAULT_SERVER_NAME || 'Jonjo' };
const roomService = internalLiveKitUrl && apiKey && apiSecret
  ? new RoomServiceClient(internalLiveKitUrl, apiKey, apiSecret)
  : null;

// Cada cargo define quais qualidades de compartilhamento de tela ele pode usar.
// A restrição de qualidade é aplicada no cliente (o LiveKit não limita bitrate
// pelo token); para um grupo de amigos é suficiente. O controle de acesso de
// verdade é o login: sem sessão, ninguém pega token nem entra na sala.
const ROLE_QUALITIES = {
  presidente: ['economy', 'sharp', 'smooth'],
  rico: ['economy', 'sharp', 'smooth'],
  pobre: ['economy'],
};
const ASSIGNABLE_ROLES = ['rico', 'pobre'];
// Quem pode criar servidores na tela de seleção.
const SERVER_CREATOR_ROLES = ['presidente', 'rico'];
const DEFAULT_CHANNEL_CAPACITY = 4;
const MAX_CHANNEL_CAPACITY = 10;

const SESSION_COOKIE = 'jonjo_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let channelWriteQueue = Promise.resolve();
let serverWriteQueue = Promise.resolve();
let userWriteQueue = Promise.resolve();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '8kb' }));

export function normalizeName(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ._'-]/gu, '').slice(0, 32)
    : '';
}

export function normalizeChannelName(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} _'-]/gu, '').slice(0, 24)
    : '';
}

export function channelSlug(value) {
  return normalizeChannelName(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

export function normalizeServerName(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} _'-]/gu, '').slice(0, 10)
    : '';
}

export function serverSlug(value) {
  return normalizeServerName(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
}

// O nome da sala no LiveKit isola cada canal dentro do seu servidor.
function roomNameFor(serverId, channelId) {
  return `${serverId}__${channelId}`;
}

export function normalizeUsername(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 20)
    : '';
}

export function normalizeChannelCapacity(value) {
  const capacity = Number(value);
  return Number.isInteger(capacity) && capacity >= 2 && capacity <= MAX_CHANNEL_CAPACITY
    ? capacity
    : null;
}

// --- Usuários e senhas -----------------------------------------------------

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

function verifyPassword(password, salt, hash) {
  const expected = Buffer.from(hash, 'hex');
  const candidate = scryptSync(password, salt, 64);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

async function loadUsers() {
  try {
    const parsed = JSON.parse(await readFile(usersFile, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('Jonjo não conseguiu ler os usuários:', error);
  }
  return [];
}

async function saveUsers(users) {
  await mkdir(path.dirname(usersFile), { recursive: true });
  const temporaryFile = `${usersFile}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(users, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryFile, usersFile);
}

function publicUser(user) {
  return {
    username: user.username,
    role: user.role,
    canShareQualities: ROLE_QUALITIES[user.role] || ROLE_QUALITIES.pobre,
  };
}

// --- Sessão (cookie assinado com HMAC) -------------------------------------

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', sessionSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifySession(token) {
  if (!token || !sessionSecret) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', sessionSecret).update(body).digest('base64url');
  const given = Buffer.from(signature);
  const good = Buffer.from(expected);
  if (given.length !== good.length || !timingSafeEqual(given, good)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(request) {
  const header = request.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function issueSession(request, response, user) {
  const secure = request.secure || request.headers['x-forwarded-proto'] === 'https';
  const token = signSession({ u: user.username, r: user.role, exp: Date.now() + SESSION_TTL_MS });
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function requireAuth(request, response, next) {
  const session = verifySession(parseCookies(request)[SESSION_COOKIE]);
  if (!session) {
    response.status(401).json({ error: 'O Jonjo precisa saber quem é você. Faça login.' });
    return;
  }
  request.user = session;
  next();
}

function requirePresidente(request, response, next) {
  if (!request.user || request.user.r !== 'presidente') {
    response.status(403).json({ error: 'Essa porta só abre para o presidente.' });
    return;
  }
  next();
}

// Freio simples de força-bruta por IP (memória, janela curta).
const loginAttempts = new Map();
function throttleAuth(request, response, next) {
  const key = request.ip || 'desconhecido';
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (entry && entry.resetAt > now && entry.count >= 20) {
    response.status(429).json({ error: 'O Jonjo pediu uma pausa. Tente de novo em alguns minutos.' });
    return;
  }
  next();
}
function registerFailure(request) {
  const key = request.ip || 'desconhecido';
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) loginAttempts.set(key, { count: 1, resetAt: now + 5 * 60 * 1000 });
  else entry.count += 1;
}

// --- Servidores e canais ---------------------------------------------------

async function saveServers(servers) {
  await mkdir(path.dirname(serversFile), { recursive: true });
  const temporaryFile = `${serversFile}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(servers, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryFile, serversFile);
}

async function loadServers() {
  try {
    const parsed = JSON.parse(await readFile(serversFile, 'utf8'));
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('Jonjo não conseguiu ler os servidores:', error);
  }
  const initialServers = [{ id: defaultServer.id, name: defaultServer.name, createdBy: 'sistema', createdAt: new Date().toISOString() }];
  await saveServers(initialServers);
  return initialServers;
}

async function saveChannelMap(map) {
  await mkdir(path.dirname(channelsFile), { recursive: true });
  const temporaryFile = `${channelsFile}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(map, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryFile, channelsFile);
}

// Os canais viram um mapa servidor -> lista de canais. O formato antigo (uma
// lista solta) é migrado para dentro do servidor padrão.
async function loadChannelMap() {
  let raw = null;
  try {
    raw = JSON.parse(await readFile(channelsFile, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('Jonjo não conseguiu ler os canais:', error);
  }
  if (Array.isArray(raw)) return { [defaultServer.id]: raw };
  if (raw && typeof raw === 'object') return raw;
  return {};
}

function serverChannels(map, serverId) {
  const list = map[serverId];
  const channels = Array.isArray(list) && list.length > 0 ? list : [defaultChannel];
  return channels.map((channel) => ({
    ...channel,
    maxParticipants: normalizeChannelCapacity(channel.maxParticipants) || DEFAULT_CHANNEL_CAPACITY,
  }));
}

function publicServer(server, participants = 0) {
  return {
    id: server.id,
    name: server.name,
    participants,
    protected: Boolean(server.passwordHash && server.passwordSalt),
  };
}

// --- Rotas -----------------------------------------------------------------

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.post('/api/auth/register', throttleAuth, async (request, response) => {
  if (!sessionSecret) {
    response.status(503).json({ error: 'O Jonjo ainda está arrumando os cadeados.' });
    return;
  }
  const username = normalizeUsername(request.body?.username);
  const password = typeof request.body?.password === 'string' ? request.body.password : '';
  if (username.length < 3) {
    response.status(400).json({ error: 'O usuário precisa de ao menos 3 caracteres (letras, números, . _ -).' });
    return;
  }
  if (password.length < 6) {
    response.status(400).json({ error: 'A senha precisa de ao menos 6 caracteres.' });
    return;
  }

  try {
    const operation = userWriteQueue.then(async () => {
      const users = await loadUsers();
      if (users.some((user) => user.username === username)) return { conflict: true };
      // O presidente é o primeiro a se cadastrar (ou quem casar com PRESIDENT_USERNAME).
      const role = users.length === 0 || (presidentUsername && username === presidentUsername) ? 'presidente' : 'pobre';
      const { salt, hash } = hashPassword(password);
      const user = { username, salt, hash, role, createdAt: new Date().toISOString() };
      await saveUsers([...users, user]);
      return { user };
    });
    userWriteQueue = operation.catch(() => undefined);
    const result = await operation;
    if (result.conflict) {
      response.status(409).json({ error: 'Esse usuário já existe. Tente entrar.' });
      return;
    }
    issueSession(request, response, result.user);
    response.status(201).json(publicUser(result.user));
  } catch (error) {
    console.error('Jonjo não conseguiu criar o usuário:', error);
    response.status(500).json({ error: 'O Jonjo tropeçou no cadastro. Tente de novo.' });
  }
});

app.post('/api/auth/login', throttleAuth, async (request, response) => {
  if (!sessionSecret) {
    response.status(503).json({ error: 'O Jonjo ainda está arrumando os cadeados.' });
    return;
  }
  const username = normalizeUsername(request.body?.username);
  const password = typeof request.body?.password === 'string' ? request.body.password : '';
  const users = await loadUsers();
  const user = users.find((item) => item.username === username);
  if (!user || !verifyPassword(password, user.salt, user.hash)) {
    registerFailure(request);
    response.status(401).json({ error: 'Usuário ou senha que o Jonjo não reconhece.' });
    return;
  }
  issueSession(request, response, user);
  response.json(publicUser(user));
});

app.post('/api/auth/logout', (_request, response) => {
  response.clearCookie(SESSION_COOKIE, { path: '/' });
  response.status(204).end();
});

app.get('/api/auth/me', requireAuth, async (request, response) => {
  const users = await loadUsers();
  const user = users.find((item) => item.username === request.user.u);
  if (!user) {
    response.clearCookie(SESSION_COOKIE, { path: '/' });
    response.status(401).json({ error: 'Sessão expirada.' });
    return;
  }
  response.json(publicUser(user));
});

app.get('/api/admin/users', requireAuth, requirePresidente, async (_request, response) => {
  const users = await loadUsers();
  response.json({
    users: users
      .map((user) => ({ username: user.username, role: user.role }))
      .sort((a, b) => a.username.localeCompare(b.username)),
  });
});

app.post('/api/admin/users/role', requireAuth, requirePresidente, async (request, response) => {
  const username = normalizeUsername(request.body?.username);
  const role = request.body?.role;
  if (!ASSIGNABLE_ROLES.includes(role)) {
    response.status(400).json({ error: 'Cargo inválido. Use "rico" ou "pobre".' });
    return;
  }
  try {
    const operation = userWriteQueue.then(async () => {
      const users = await loadUsers();
      const target = users.find((item) => item.username === username);
      if (!target) return { notFound: true };
      if (target.role === 'presidente') return { forbidden: true };
      target.role = role;
      await saveUsers(users);
      return { user: target };
    });
    userWriteQueue = operation.catch(() => undefined);
    const result = await operation;
    if (result.notFound) {
      response.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }
    if (result.forbidden) {
      response.status(403).json({ error: 'O presidente não muda de cargo por aqui.' });
      return;
    }
    response.json({ username: result.user.username, role: result.user.role });
  } catch (error) {
    console.error('Jonjo não conseguiu mudar o cargo:', error);
    response.status(500).json({ error: 'O Jonjo perdeu a caneta. Tente de novo.' });
  }
});

async function roomParticipantCounts() {
  if (!roomService) return new Map();
  try {
    const rooms = await roomService.listRooms();
    return new Map(rooms.map((room) => [room.name, Number(room.numParticipants || 0)]));
  } catch (error) {
    console.error('Jonjo não conseguiu contar as pessoas:', error);
    return new Map();
  }
}

app.get('/api/servers', requireAuth, async (_request, response) => {
  const servers = await loadServers();
  const map = await loadChannelMap();
  const counts = await roomParticipantCounts();
  response.json({
    servers: servers.map((server) => {
      const participants = serverChannels(map, server.id)
        .reduce((total, channel) => total + (counts.get(roomNameFor(server.id, channel.id)) || 0), 0);
      return publicServer(server, participants);
    }),
  });
});

app.post('/api/servers', requireAuth, async (request, response) => {
  if (!SERVER_CREATOR_ROLES.includes(request.user.r)) {
    response.status(403).json({ error: 'Só o presidente e os ricos podem abrir servidores.' });
    return;
  }
  const name = normalizeServerName(request.body?.name);
  const id = serverSlug(name);
  const password = typeof request.body?.password === 'string' ? request.body.password : '';
  if (name.length < 2 || id.length < 2) {
    response.status(400).json({ error: 'O nome do servidor precisa de 2 a 10 caracteres.' });
    return;
  }
  if (password.length > 0 && (password.length < 4 || password.length > 64)) {
    response.status(400).json({ error: 'A senha do servidor precisa ter entre 4 e 64 caracteres, ou ficar vazia.' });
    return;
  }

  try {
    const operation = serverWriteQueue.then(async () => {
      const servers = await loadServers();
      const existing = servers.find((server) => server.id === id);
      if (existing) return { server: publicServer(existing), created: false };
      const server = { id, name, createdBy: request.user.u, createdAt: new Date().toISOString() };
      if (password) {
        const credentials = hashPassword(password);
        server.passwordSalt = credentials.salt;
        server.passwordHash = credentials.hash;
      }
      await saveServers([...servers, server]);
      const map = await loadChannelMap();
      if (!Array.isArray(map[id]) || map[id].length === 0) {
        map[id] = [{ id: defaultChannel.id, name: defaultChannel.name }];
        await saveChannelMap(map);
      }
      return { server: publicServer(server), created: true };
    });
    serverWriteQueue = operation.catch(() => undefined);
    const result = await operation;
    response.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    console.error('Jonjo não conseguiu criar o servidor:', error);
    response.status(500).json({ error: 'O Jonjo perdeu a plaquinha do servidor. Tente de novo.' });
  }
});

app.get('/api/channels', requireAuth, async (request, response) => {
  const requested = typeof request.query?.server === 'string' ? request.query.server : '';
  const servers = await loadServers();
  const server = servers.find((item) => item.id === requested)
    || servers.find((item) => item.id === defaultServer.id)
    || servers[0];
  const map = await loadChannelMap();
  const counts = await roomParticipantCounts();
  response.json({
    channels: serverChannels(map, server.id).map((channel) => ({
      ...channel,
      participants: counts.get(roomNameFor(server.id, channel.id)) || 0,
    })),
  });
});

app.post('/api/channels', requireAuth, async (request, response) => {
  const name = normalizeChannelName(request.body?.name);
  const id = channelSlug(name);
  const maxParticipants = normalizeChannelCapacity(request.body?.maxParticipants);
  if (name.length < 2 || id.length < 2) {
    response.status(400).json({ error: 'O Jonjo precisa de pelo menos duas letras para batizar um canal.' });
    return;
  }
  if (!maxParticipants) {
    response.status(400).json({ error: 'Escolha um limite entre 2 e 10 pessoas.' });
    return;
  }
  const requestedServer = typeof request.body?.server === 'string' ? request.body.server : defaultServer.id;

  try {
    const operation = channelWriteQueue.then(async () => {
      const servers = await loadServers();
      const server = servers.find((item) => item.id === requestedServer);
      if (!server) return { noServer: true };
      const map = await loadChannelMap();
      const channels = serverChannels(map, server.id);
      const existing = channels.find((channel) => channel.id === id);
      if (existing) return { channel: existing, created: false };
      const channel = { id, name, maxParticipants, createdBy: request.user.u };
      map[server.id] = [...channels, channel];
      await saveChannelMap(map);
      return { channel, created: true };
    });
    channelWriteQueue = operation.catch(() => undefined);
    const result = await operation;
    if (result.noServer) {
      response.status(404).json({ error: 'O Jonjo procurou esse servidor e não achou.' });
      return;
    }
    response.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    console.error('Jonjo não conseguiu criar o canal:', error);
    response.status(500).json({ error: 'O Jonjo perdeu a plaquinha desse canal. Tente de novo.' });
  }
});

app.post('/api/token', throttleAuth, requireAuth, async (request, response) => {
  if (!apiKey || !apiSecret || !publicLiveKitUrl) {
    response.status(503).json({ error: 'O Jonjo ainda está arrumando os cabos.' });
    return;
  }

  const users = await loadUsers();
  const user = users.find((item) => item.username === request.user.u);
  if (!user) {
    response.clearCookie(SESSION_COOKIE, { path: '/' });
    response.status(401).json({ error: 'Sessão expirada.' });
    return;
  }

  const requestedServer = typeof request.body?.server === 'string' ? request.body.server : defaultServer.id;
  const servers = await loadServers();
  const server = servers.find((item) => item.id === requestedServer);
  if (!server) {
    response.status(404).json({ error: 'O Jonjo procurou esse servidor e não achou.' });
    return;
  }
  if (server.passwordHash && server.passwordSalt) {
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    if (!password || !verifyPassword(password, server.passwordSalt, server.passwordHash)) {
      registerFailure(request);
      response.status(403).json({ error: 'A senha desse servidor não confere.', code: 'SERVER_PASSWORD_REQUIRED' });
      return;
    }
  }
  const requestedRoom = typeof request.body?.room === 'string' ? request.body.room : defaultChannel.id;
  const map = await loadChannelMap();
  const channel = serverChannels(map, server.id).find((item) => item.id === requestedRoom);
  if (!channel) {
    response.status(404).json({ error: 'O Jonjo procurou esse canal até debaixo do sofá e não achou.' });
    return;
  }
  const roomName = roomNameFor(server.id, requestedRoom);
  if (roomService) {
    try {
      const activeRooms = await roomService.listRooms([roomName]);
      const activeRoom = activeRooms[0];
      if (activeRoom && Number(activeRoom.numParticipants || 0) >= channel.maxParticipants) {
        response.status(409).json({ error: `Esse canal já está com ${channel.maxParticipants} pessoas.`, code: 'CHANNEL_FULL' });
        return;
      }
      if (!activeRoom) {
        await roomService.createRoom({ name: roomName, maxParticipants: channel.maxParticipants });
      }
    } catch (error) {
      console.error('Jonjo não conseguiu preparar a lotação da sala:', error);
      response.status(503).json({ error: 'O Jonjo não conseguiu conferir se ainda cabe gente nesse canal.' });
      return;
    }
  }
  // A identidade aleatória permite que a mesma pessoa entre de dois lugares sem
  // se expulsar. O nome exibido é o próprio usuário.
  const identity = `${user.username}-${randomUUID().slice(0, 8)}`;
  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name: user.username,
    ttl: '12h',
    metadata: JSON.stringify({ role: user.role }),
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    // Habilitado para transmitir o aviso de tela cheia aos demais participantes.
    canPublishData: true,
    canSubscribe: true,
  });

  response.json({
    token: await token.toJwt(),
    serverUrl: publicLiveKitUrl,
    role: user.role,
    canShareQualities: ROLE_QUALITIES[user.role] || ROLE_QUALITIES.pobre,
  });
});

const distDir = path.join(rootDir, 'dist');
app.use(express.static(distDir, { maxAge: '1h', index: false }));
app.get('/{*splat}', (_request, response) => response.sendFile(path.join(distDir, 'index.html')));

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, '0.0.0.0', () => console.log(`Jonjo acordou na porta ${port}`));
}

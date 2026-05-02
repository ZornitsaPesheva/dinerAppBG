const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { createHmac, randomUUID, timingSafeEqual } = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'dishes.json');
const USER_DATA_DIR = path.join(DATA_DIR, 'users');
const PUBLIC_DIR = path.join(__dirname, 'public');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '716007402302-ndd6hn2shv69epsn3aogp4v0es8hh66p.apps.googleusercontent.com';
const SESSION_COOKIE_NAME = 'diner_session';
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7;
const SESSION_SECRET = process.env.SESSION_SECRET || `dev-session-${randomUUID()}`;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || '';
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || '';
const FIRESTORE_COLLECTION = process.env.FIRESTORE_COLLECTION || 'user_dishes';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8'
};

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(USER_DATA_DIR, { recursive: true });

  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, '[]\n', 'utf8');
  }
}

function sanitizeUserIdForFile(userId) {
  return userId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getUserDataFile(userId) {
  return path.join(USER_DATA_DIR, `${sanitizeUserIdForFile(userId)}.json`);
}

async function ensureUserDataFile(userId) {
  await ensureDataFile();

  const userFile = getUserDataFile(userId);

  try {
    await fs.access(userFile);
  } catch {
    let seedData = [];

    try {
      const raw = await fs.readFile(DATA_FILE, 'utf8');
      const parsed = JSON.parse((raw || '[]').replace(/^\uFEFF/, ''));
      if (Array.isArray(parsed)) {
        seedData = parsed;
      }
    } catch {
      seedData = [];
    }

    await fs.writeFile(userFile, `${JSON.stringify(seedData, null, 2)}\n`, 'utf8');
  }

  return userFile;
}

async function readDishes(userId) {
  if (firestore) {
    return readDishesFromFirestore(userId);
  }

  const userFile = await ensureUserDataFile(userId);
  const raw = await fs.readFile(userFile, 'utf8');
  const parsed = JSON.parse((raw || '[]').replace(/^\uFEFF/, ''));
  return Array.isArray(parsed) ? parsed : [];
}

async function writeDishes(userId, dishes) {
  if (firestore) {
    await writeDishesToFirestore(userId, dishes);
    return;
  }

  const userFile = await ensureUserDataFile(userId);
  await fs.writeFile(userFile, `${JSON.stringify(dishes, null, 2)}\n`, 'utf8');
}

function createFirebaseFirestore() {
  try {
    if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
      return null;
    }

    if (getApps().length === 0) {
      initializeApp({
        credential: cert({
          projectId: FIREBASE_PROJECT_ID,
          clientEmail: FIREBASE_CLIENT_EMAIL,
          privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
      });
    }

    return getFirestore();
  } catch (error) {
    console.error('Firebase initialization failed. Falling back to local JSON storage.', error.message || error);
    return null;
  }
}

const firestore = createFirebaseFirestore();

function getFirestoreUserDocument(userId) {
  return firestore.collection(FIRESTORE_COLLECTION).doc(userId);
}

async function seedFirestoreUserDishes(userId) {
  const seedData = await readLegacyDishes();
  await getFirestoreUserDocument(userId).set({
    dishes: seedData,
    updatedAt: new Date().toISOString()
  });
  return seedData;
}

async function readDishesFromFirestore(userId) {
  const snapshot = await getFirestoreUserDocument(userId).get();

  if (!snapshot.exists) {
    return seedFirestoreUserDishes(userId);
  }

  const payload = snapshot.data() || {};
  return Array.isArray(payload.dishes) ? payload.dishes : [];
}

async function writeDishesToFirestore(userId, dishes) {
  await getFirestoreUserDocument(userId).set({
    dishes,
    updatedAt: new Date().toISOString()
  });
}

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');

      if (separatorIndex === -1) {
        return cookies;
      }

      const key = part.slice(0, separatorIndex);
      const value = part.slice(separatorIndex + 1);
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function signSessionPayload(payload) {
  return createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

function createSessionToken(user) {
  const sessionPayload = JSON.stringify({
    sub: user.sub,
    email: user.email,
    name: user.name,
    picture: user.picture || '',
    exp: Date.now() + SESSION_DURATION_MS
  });
  const encodedPayload = Buffer.from(sessionPayload, 'utf8').toString('base64url');
  const signature = signSessionPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function readSessionToken(request) {
  const cookies = parseCookies(request.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || '';
}

function verifySessionToken(token) {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split('.');

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signSessionPayload(encodedPayload);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (providedBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));

    if (!payload.sub || payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function getAuthenticatedUser(request) {
  return verifySessionToken(readSessionToken(request));
}

function setSessionCookie(response, token) {
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`
  );
}

function clearSessionCookie(response) {
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
  );
}

function getPublicUserProfile(user) {
  if (!user) {
    return null;
  }

  return {
    sub: user.sub,
    email: user.email,
    name: user.name,
    picture: user.picture || ''
  };
}

async function verifyGoogleCredential(credential) {
  if (!googleClient || !GOOGLE_CLIENT_ID) {
    throw new Error('Google sign-in is not configured on the server');
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: GOOGLE_CLIENT_ID
  });
  const payload = ticket.getPayload();

  if (!payload || !payload.sub || !payload.email) {
    throw new Error('Invalid Google account payload');
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name || payload.email,
    picture: payload.picture || ''
  };
}

function requireAuthenticatedUser(request, response) {
  const user = getAuthenticatedUser(request);

  if (!user) {
    sendJson(response, 401, { error: 'You need to sign in with Google.' });
    return null;
  }

  return user;
}

async function readLegacyDishes() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const parsed = JSON.parse((raw || '[]').replace(/^\uFEFF/, ''));
  return Array.isArray(parsed) ? parsed : [];
}

function normalizeDish(dish) {
  const history = Array.isArray(dish.cookHistory) ? dish.cookHistory : [];
  const lastCookedAt = history.length > 0 ? history[history.length - 1] : null;

  return {
    id: dish.id,
    name: dish.name,
    notes: dish.notes || '',
    cookCount: dish.cookCount || history.length,
    lastCookedAt,
    cookHistory: history
  };
}

function getSuggestionRank(dish) {
  return {
    neverCooked: dish.cookCount === 0 ? 0 : 1,
    lastCookedAt: dish.lastCookedAt || '0000-00-00T00:00:00.000Z',
    cookCount: dish.cookCount,
    name: dish.name.toLowerCase()
  };
}

function sortSuggestedDishes(dishes) {
  return [...dishes].sort((left, right) => {
    const leftRank = getSuggestionRank(left);
    const rightRank = getSuggestionRank(right);

    if (leftRank.neverCooked !== rightRank.neverCooked) {
      return leftRank.neverCooked - rightRank.neverCooked;
    }

    if (leftRank.lastCookedAt !== rightRank.lastCookedAt) {
      return leftRank.lastCookedAt.localeCompare(rightRank.lastCookedAt);
    }

    if (leftRank.cookCount !== rightRank.cookCount) {
      return leftRank.cookCount - rightRank.cookCount;
    }

    return leftRank.name.localeCompare(rightRank.name);
  });
}

function sortRarestDishes(dishes) {
  return [...dishes].sort((left, right) => {
    if (left.cookCount !== right.cookCount) {
      return left.cookCount - right.cookCount;
    }

    const leftLastCookedAt = left.lastCookedAt || '0000-00-00T00:00:00.000Z';
    const rightLastCookedAt = right.lastCookedAt || '0000-00-00T00:00:00.000Z';

    if (leftLastCookedAt !== rightLastCookedAt) {
      return leftLastCookedAt.localeCompare(rightLastCookedAt);
    }

    return left.name.localeCompare(right.name, 'bg');
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let data = '';

    request.on('data', chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Request body too large'));
        request.destroy();
      }
    });

    request.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    request.on('error', reject);
  });
}

function buildApiResponse(dishes) {
  const normalized = dishes.map(normalizeDish);
  const oldest = sortSuggestedDishes(normalized)[0];
  const rarest = sortRarestDishes(normalized).find(dish => !oldest || dish.id !== oldest.id);
  const suggestions = [oldest, rarest].filter(Boolean);

  return {
    dishes: normalized,
    suggestions,
    generatedAt: new Date().toISOString()
  };
}

async function serveStaticFile(requestPath, response) {
  const urlPathname = new URL(requestPath, 'http://localhost').pathname;
  const safePath = urlPathname === '/' ? '/index.html' : urlPathname;
  const resolvedPath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    sendJson(response, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const fileContent = await fs.readFile(resolvedPath);
    const extension = path.extname(resolvedPath);
    const contentType = MIME_TYPES[extension] || 'application/octet-stream';

    response.writeHead(200, { 'Content-Type': contentType });
    response.end(fileContent);
  } catch {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    const indexContent = await fs.readFile(indexPath);
    response.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
    response.end(indexContent);
  }
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === 'GET' && url.pathname === '/api/session') {
    const user = getAuthenticatedUser(request);
    sendJson(response, 200, {
      googleClientId: GOOGLE_CLIENT_ID,
      user: getPublicUserProfile(user)
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/google') {
    const payload = await readRequestBody(request);
    const credential = typeof payload.credential === 'string' ? payload.credential : '';

    if (!credential) {
      sendJson(response, 400, { error: 'Missing Google credential' });
      return;
    }

    const user = await verifyGoogleCredential(credential);
    setSessionCookie(response, createSessionToken(user));
    await readDishes(user.sub);
    sendJson(response, 200, {
      googleClientId: GOOGLE_CLIENT_ID,
      user: getPublicUserProfile(user)
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    clearSessionCookie(response);
    sendJson(response, 200, { ok: true });
    return;
  }

  const user = requireAuthenticatedUser(request, response);

  if (!user) {
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/dishes') {
    const dishes = await readDishes(user.sub);
    sendJson(response, 200, buildApiResponse(dishes));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/dishes') {
    const payload = await readRequestBody(request);
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const notes = typeof payload.notes === 'string' ? payload.notes.trim() : '';

    if (!name) {
      sendJson(response, 400, { error: 'Dish name is required' });
      return;
    }

    const dishes = await readDishes(user.sub);
    const exists = dishes.some(dish => dish.name.toLowerCase() === name.toLowerCase());

    if (exists) {
      sendJson(response, 409, { error: 'Dish already exists' });
      return;
    }

    dishes.push({
      id: randomUUID(),
      name,
      notes,
      cookCount: 0,
      cookHistory: []
    });

    await writeDishes(user.sub, dishes);
    sendJson(response, 201, buildApiResponse(dishes));
    return;
  }

  const cookMatch = url.pathname.match(/^\/api\/dishes\/([^/]+)\/cook$/);

  if (request.method === 'POST' && cookMatch) {
    const dishId = cookMatch[1];
    const dishes = await readDishes(user.sub);
    const dish = dishes.find(item => item.id === dishId);

    if (!dish) {
      sendJson(response, 404, { error: 'Dish not found' });
      return;
    }

    const cookedAt = new Date().toISOString();
    const history = Array.isArray(dish.cookHistory) ? dish.cookHistory : [];
    history.push(cookedAt);
    dish.cookHistory = history;
    dish.cookCount = history.length;

    await writeDishes(user.sub, dishes);
    sendJson(response, 200, buildApiResponse(dishes));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/dishes/merge') {
    const payload = await readRequestBody(request);
    const demoDishes = Array.isArray(payload.dishes) ? payload.dishes : [];
    const dishes = await readDishes(user.sub);

    for (const demoDish of demoDishes) {
      const name = typeof demoDish.name === 'string' ? demoDish.name.trim() : '';
      if (!name) continue;

      const demoHistory = Array.isArray(demoDish.cookHistory) ? [...demoDish.cookHistory] : [];
      const existing = dishes.find(d => d.name.toLowerCase() === name.toLowerCase());

      if (existing) {
        const existingHistory = Array.isArray(existing.cookHistory) ? existing.cookHistory : [];
        existing.cookHistory = [...existingHistory, ...demoHistory].sort();
        existing.cookCount = existing.cookHistory.length;
      } else {
        const sortedHistory = demoHistory.sort();
        dishes.push({
          id: randomUUID(),
          name,
          notes: typeof demoDish.notes === 'string' ? demoDish.notes.trim() : '',
          cookCount: sortedHistory.length,
          cookHistory: sortedHistory
        });
      }
    }

    await writeDishes(user.sub, dishes);
    sendJson(response, 200, buildApiResponse(dishes));
    return;
  }

  sendJson(response, 404, { error: 'API route not found' });
}

const server = http.createServer(async (request, response) => {
  try {
    if (!request.url) {
      sendJson(response, 400, { error: 'Missing request URL' });
      return;
    }

    if (request.url.startsWith('/api/')) {
      await handleApi(request, response);
      return;
    }

    await serveStaticFile(request.url, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message || 'Internal server error' });
  }
});

server.on('error', error => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process or run with PORT=<free-port>.`);
    process.exitCode = 1;
    return;
  }

  console.error('Server failed to start:', error);
  process.exitCode = 1;
});

ensureDataFile()
  .then(() => {
    if (!process.env.SESSION_SECRET) {
      console.warn('SESSION_SECRET is not set. Using a temporary development session secret.');
    }

    if (firestore) {
      console.log(`Firestore storage is enabled (collection: ${FIRESTORE_COLLECTION}).`);
    } else {
      console.log('Using local JSON storage from data/users.');
    }

    server.listen(PORT, () => {
      console.log(`Diner app is running on http://localhost:${PORT}`);
    });
  })
  .catch(error => {
    console.error('Failed to initialize data storage:', error);
    process.exitCode = 1;
  });
// Veribly prototype server. No dependencies. Run: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC = __dirname; // flat layout: pages sit next to server.js
const DB = path.join(__dirname, 'data.json');
const MAX_BODY = 15 * 1024 * 1024; // 15 MB

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB, 'utf8')); }
  catch { return { portfolios: {} }; }
}
function saveDB(db) { fs.writeFileSync(DB, JSON.stringify(db)); }

function sendFile(res, file, type) {
  fs.readFile(path.join(PUBLIC, file), (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(data);
  });
}
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    // Pages
    if (req.method === 'GET' && p === '/') return sendFile(res, 'index.html', 'text/html');
    if (req.method === 'GET' && p.startsWith('/p/')) return sendFile(res, 'portfolio.html', 'text/html');

    // Create a portfolio. Returns a public id and a private owner token.
    if (req.method === 'POST' && p === '/api/portfolios') {
      const db = loadDB();
      const id = crypto.randomBytes(8).toString('hex');
      const ownerToken = crypto.randomBytes(16).toString('hex');
      db.portfolios[id] = { ownerToken, created: Date.now(), items: [] };
      saveDB(db);
      return sendJSON(res, 201, { id, ownerToken });
    }

    // Add a capture. Server timestamps it and verifies the hash against the bytes it received.
    const addMatch = p.match(/^\/api\/portfolios\/([a-f0-9]+)\/captures$/);
    if (req.method === 'POST' && addMatch) {
      const db = loadDB();
      const pf = db.portfolios[addMatch[1]];
      if (!pf) return sendJSON(res, 404, { error: 'no portfolio' });
      if (req.headers['x-owner-token'] !== pf.ownerToken) return sendJSON(res, 403, { error: 'bad owner token' });

      const body = JSON.parse(await readBody(req));
      const match = /^data:image\/jpeg;base64,(.+)$/.exec(body.image || '');
      if (!match) return sendJSON(res, 400, { error: 'expected a JPEG data URL' });
      const bytes = Buffer.from(match[1], 'base64');
      const serverHash = crypto.createHash('sha256').update(bytes).digest('hex');
      if (serverHash !== body.hash) return sendJSON(res, 400, { error: 'hash mismatch' });

      // `live` comes from the client, so it is a label, not proof. Hardware signing would be needed to verify it.
      const item = { id: crypto.randomBytes(6).toString('hex'), hash: serverHash, capturedAt: Date.now(), live: body.live === true, image: body.image };
      pf.items.unshift(item);
      saveDB(db);
      return sendJSON(res, 201, { id: item.id, capturedAt: item.capturedAt, hash: item.hash });
    }

    // Public read. Anyone with the id can view, no account needed.
    const getMatch = p.match(/^\/api\/portfolios\/([a-f0-9]+)$/);
    if (req.method === 'GET' && getMatch) {
      const pf = loadDB().portfolios[getMatch[1]];
      if (!pf) return sendJSON(res, 404, { error: 'not found' });
      return sendJSON(res, 200, { created: pf.created, items: pf.items });
    }

    res.writeHead(404); res.end('Not found');
  } catch (e) {
    sendJSON(res, 400, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`Veribly prototype on http://localhost:${PORT}`));

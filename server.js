// Kofa Proptech Web & USSD Server (Zero external dependencies).
// Serves the full multi-role platform, Africa's Talking USSD & SMS webhooks,
// and REST APIs for public users, tenants, agents, landlords and admins.
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const db = require('./src/db');
const rentify = require('./src/rentify');
const ussd = require('./src/ussd');
const at = require('./src/africastalking');
const { toE164, toLocal } = require('./src/networks');

const PUBLIC = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  const isText = typeof body === 'string';
  res.writeHead(status, {
    'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isText ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2e6) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      const type = req.headers['content-type'] || '';
      try {
        if (type.includes('application/json')) resolve(raw ? JSON.parse(raw) : {});
        else resolve(Object.fromEntries(new URLSearchParams(raw)));
      } catch {
        resolve({});
      }
    });
  });
}

function serveStatic(req, res, pathname) {
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'File not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

// ---------------- USSD & AFRICA'S TALKING WEBHOOKS ----------------
// Africa's Talking posts { sessionId, serviceCode, phoneNumber, text }
route('POST', '/ussd', async ({ body }) => ({ __text: await ussd.handle(body) }));
route('GET', '/ussd-test', async ({ query }) => ({
  __text: await ussd.handle({
    sessionId: query.get('sessionId') || 'test-session',
    serviceCode: query.get('serviceCode') || config.ussdCode,
    phoneNumber: query.get('phoneNumber') || '+2348030000000',
    text: query.get('text') || '',
  })
}));

// SMS delivery callbacks from Africa's Talking
route('POST', '/callbacks/sms', ({ body }) => {
  console.log(`[SMS DLR] ${body.phoneNumber} -> ${body.status}`);
  return { __text: 'OK' };
});

// Config & platform stats
route('GET', '/api/config', () => ({
  ussdCode: config.ussdCode,
  mode: config.at.simulate ? 'Simulation' : 'Africa\'s Talking Live',
  atConfigured: !config.at.simulate,
}));

// ---------------- PUBLIC PROPERTY APIS ----------------
// Public only sees properties published by agents
route('GET', '/api/properties', ({ query }) => ({
  properties: rentify.listPublic(Object.fromEntries(query)),
}));

route('GET', '/api/properties/:id', ({ params }) => {
  rentify.seed();
  const p = db.data.properties.find((x) => x.id === params.id || x.accountNumber === params.id);
  if (!p) {
    const err = new Error('Property not found');
    err.status = 404;
    throw err;
  }
  return { property: rentify.publicProperty(p) };
});

// ---------------- LANDLORD APIS ----------------
// Landlord uploads private property. Unique account number generated.
route('POST', '/api/landlord/properties', ({ body }) => rentify.createProperty(body));

route('GET', '/api/landlord/properties', () => {
  rentify.seed();
  return {
    properties: db.data.properties.map((p) => ({
      ...p,
      publishedCount: db.data.publications.filter((pub) => pub.propertyId === p.id && pub.status === 'published').length,
    })),
  };
});

// ---------------- AGENT APIS ----------------
// Agents view available pool of landlord uploads
route('GET', '/api/agent/pool', () => {
  rentify.seed();
  return {
    pool: db.data.properties.map((p) => ({
      ...rentify.publicProperty(p),
      originalRent: p.originalRent,
      landlordName: p.landlordName,
      status: p.status,
    })),
  };
});

// Agent publishes property from pool (adds 10% auto-commission)
route('POST', '/api/agent/publish/:id', ({ params, body }) => rentify.publishProperty(params.id, body));

// Agent manages inspections requested by tenants
route('GET', '/api/agent/inspections', ({ query }) => {
  const phone = query.get('phone') ? toE164(query.get('phone')) : null;
  let list = db.data.inspections || [];
  if (phone) list = list.filter((i) => i.agentPhone === phone);
  return { inspections: list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
});

// ---------------- TENANT & INSPECTION APIS ----------------
// Tenant books inspection -> Generates Tracking ID
route('POST', '/api/inspections/book', async ({ body }) => rentify.bookInspection(body));

// Update inspection status (Confirmed, Done, Cancelled, Declined)
route('PATCH', '/api/inspections/:trackingId/status', ({ params, body }) =>
  rentify.updateInspectionStatus(params.trackingId, body.status)
);

// Get inspection by Tracking ID
route('GET', '/api/inspections/:trackingId', ({ params }) => {
  const item = db.data.inspections.find((i) => i.trackingId === params.trackingId);
  if (!item) {
    const err = new Error('Inspection not found');
    err.status = 404;
    throw err;
  }
  return { inspection: item };
});

// Tenant checkout reservation (prevents double payment)
route('POST', '/api/inspections/:trackingId/reserve', ({ params }) =>
  rentify.reserveForCheckout(params.trackingId)
);

// Tenant completes rental payment (records rent and 10% commission separately)
route('POST', '/api/inspections/:trackingId/pay', ({ params }) =>
  rentify.processPayment(params.trackingId)
);

// ---------------- ADMIN APIS ----------------
route('GET', '/api/admin/overview', () => {
  rentify.seed();
  return {
    stats: {
      totalProperties: db.data.properties.length,
      publishedListings: db.data.properties.filter((p) =>
        db.data.publications.some((x) => x.propertyId === p.id && x.status === 'published')
      ).length,
      inspections: db.data.inspections.length,
      payments: db.data.payments.length,
      totalRentCollected: db.data.payments.reduce((acc, p) => acc + (p.landlordRent || 0), 0),
      totalCommission: db.data.payments.reduce((acc, p) => acc + (p.agentCommission || 0), 0),
    },
    payments: db.data.payments,
    inspections: db.data.inspections,
    properties: db.data.properties,
  };
});

route('POST', '/api/admin/payments/:id/release', ({ params }) =>
  rentify.releaseCommission(params.id)
);

// ---------------- HTTP SERVER ----------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
  if (!r) {
    if (req.method === 'GET' && !pathname.startsWith('/api/')) {
      return serveStatic(req, res, pathname);
    }
    return send(res, 404, { error: 'Not found.' });
  }

  const m = pathname.match(r.re);
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  try {
    const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
    const out = await r.handler({ req, body, params, query: url.searchParams });
    if (out && typeof out.__text === 'string') return send(res, 200, out.__text);
    return send(res, 200, out);
  } catch (e) {
    if (e.status) return send(res, e.status, { error: e.message });
    console.error(e);
    return send(res, 500, { error: e.message || 'Server error' });
  }
});

rentify.seed();

if (require.main === module) {
  server.listen(config.port, () => {
    console.log(`\n======================================================`);
    console.log(`  KOFA PROPTECH PLATFORM RUNNING ON PORT ${config.port}`);
    console.log(`  Web & Dashboards: http://localhost:${config.port}`);
    console.log(`  Interactive USSD Simulator: http://localhost:${config.port}/ussd-simulator.html`);
    console.log(`  USSD Gateway Webhook: http://localhost:${config.port}/ussd (${config.ussdCode})`);
    console.log(`  Mode: ${config.at.simulate ? 'SIMULATION (SMS logged to console)' : 'LIVE AFRICA\'S TALKING'}`);
    console.log(`======================================================\n`);
  });
}

module.exports = { server };

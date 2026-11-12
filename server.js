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
const auth = require('./src/auth');
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

function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(c => {
    const parts = c.split('=');
    list[parts.shift().trim()] = decodeURI(parts.join('='));
  });
  return list;
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
route('POST', '/ussd', async ({ body }) => ({ __text: await ussd.handle(body) }));
route('GET', '/ussd-test', async ({ query }) => ({
  __text: await ussd.handle({
    sessionId: query.get('sessionId') || 'test-session',
    serviceCode: query.get('serviceCode') || config.ussdCode,
    phoneNumber: query.get('phoneNumber') || '+2348030000000',
    text: query.get('text') || '',
  })
}));

route('POST', '/callbacks/sms', ({ body }) => {
  console.log(`[SMS DLR] ${body.phoneNumber} -> ${body.status}`);
  return { __text: 'OK' };
});

route('GET', '/api/config', () => ({
  ussdCode: config.ussdCode,
  mode: config.at.simulate ? 'Simulation' : 'Africa\'s Talking Live',
  atConfigured: !config.at.simulate,
}));

// ---------------- AUTHENTICATION APIS ----------------
route('POST', '/api/auth/register', ({ body }) => {
  const result = auth.registerUser(body);
  const cookieStr = `${auth.COOKIE_NAME}=${result.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}`;
  return { ...result, __headers: { 'Set-Cookie': cookieStr } };
});

route('POST', '/api/auth/login', ({ body }) => {
  const result = auth.loginUser(body.login || body.email, body.password);
  const cookieStr = `${auth.COOKIE_NAME}=${result.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}`;
  return { ...result, __headers: { 'Set-Cookie': cookieStr } };
});

route('POST', '/api/auth/logout', ({ token }) => {
  if (token) auth.deleteSession(token);
  const cookieStr = `${auth.COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`;
  return { success: true, __headers: { 'Set-Cookie': cookieStr } };
});

route('GET', '/api/auth/me', ({ session }) => {
  if (!session) return { user: null };
  return { user: session };
});

// ---------------- PUBLIC PROPERTY APIS ----------------
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
route('POST', '/api/landlord/properties', ({ body, session }) => {
  const p = rentify.createProperty({
    ...body,
    landlordName: (session && session.name) || body.landlordName || 'Verified Landlord',
    landlordPhone: (session && session.phone) || body.landlordPhone || '',
  });
  return p;
});

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

route('POST', '/api/agent/publish/:id', ({ params, body, session }) => {
  const agentData = {
    agentName: (session && session.name) || body.agentName || 'Kofa Verified Agent',
    agentPhone: (session && session.phone) || body.agentPhone || '+2348030000001',
    agency: (session && session.agency) || body.agency || 'Independent Agency',
    agentCode: (session && session.agentCode) || body.agentCode,
  };
  return rentify.publishProperty(params.id, agentData);
});

route('GET', '/api/agent/inspections', ({ query, session }) => {
  const phone = (session && session.phone) || (query.get('phone') ? toE164(query.get('phone')) : null);
  let list = db.data.inspections || [];
  if (phone) list = list.filter((i) => i.agentPhone === phone);
  return { inspections: list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
});

// ---------------- TENANT & INSPECTION APIS ----------------
route('POST', '/api/inspections/book', async ({ body, session }) => {
  return rentify.bookInspection({
    ...body,
    tenantName: (session && session.name) || body.tenantName,
    tenantPhone: (session && session.phone) || body.tenantPhone,
  });
});

route('PATCH', '/api/inspections/:trackingId/status', ({ params, body }) =>
  rentify.updateInspectionStatus(params.trackingId, body.status)
);

route('GET', '/api/inspections/:trackingId', ({ params }) => {
  const item = db.data.inspections.find((i) => i.trackingId === params.trackingId);
  if (!item) {
    const err = new Error('Inspection not found');
    err.status = 404;
    throw err;
  }
  return { inspection: item };
});

route('POST', '/api/inspections/:trackingId/reserve', ({ params }) =>
  rentify.reserveForCheckout(params.trackingId)
);

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

// ---------------- HTTP SERVER WITH ROLE-BASED ACCESS CONTROL ----------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  const cookies = parseCookies(req);
  const token = cookies[auth.COOKIE_NAME];
  const session = auth.getSession(token);

  // Role protected dashboard pages
  if (req.method === 'GET') {
    if (pathname.startsWith('/admin/') && (!session || session.role !== 'admin')) {
      return send(res, 302, '', { Location: '/login.html?redirect=' + encodeURIComponent(pathname) });
    }
    if (pathname.startsWith('/agent/') && (!session || session.role !== 'agent')) {
      return send(res, 302, '', { Location: '/login.html?redirect=' + encodeURIComponent(pathname) });
    }
    if (pathname.startsWith('/landlord/') && (!session || session.role !== 'landlord')) {
      return send(res, 302, '', { Location: '/login.html?redirect=' + encodeURIComponent(pathname) });
    }
    if (pathname.startsWith('/tenant/') && (!session || session.role !== 'tenant')) {
      return send(res, 302, '', { Location: '/login.html?redirect=' + encodeURIComponent(pathname) });
    }
  }

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
    const out = await r.handler({ req, body, params, query: url.searchParams, session, token });
    if (out && typeof out.__text === 'string') return send(res, 200, out.__text);
    if (out && out.__headers) {
      const headers = out.__headers;
      delete out.__headers;
      return send(res, 200, out, headers);
    }
    return send(res, 200, out);
  } catch (e) {
    if (e.status) return send(res, e.status, { error: e.message });
    console.error(e);
    return send(res, 500, { error: e.message || 'Server error' });
  }
});

rentify.seed();
auth.seedDefaultUsers();

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

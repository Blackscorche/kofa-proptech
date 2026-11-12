// Authentication and session management for Kofa
const crypto = require('crypto');
const db = require('./db');
const { toE164 } = require('./networks');

const COOKIE_NAME = 'kofa_session';

// Hash password with salt
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const verify = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === verify;
}

function seedDefaultUsers() {
  if (!db.data.users) db.data.users = [];
  if (db.data.users.length) return;

  const defaultUsers = [
    {
      id: 'USR-ADMIN1',
      name: 'Platform Admin',
      email: 'admin@kofa.ng',
      phone: '+2348000000001',
      password: hashPassword('admin123'),
      role: 'admin',
      status: 'active',
      createdAt: new Date().toISOString()
    },
    {
      id: 'USR-AGENT1',
      name: 'Abubakar Sadiq',
      email: 'agent@kofa.ng',
      phone: '+2348030000001',
      password: hashPassword('agent123'),
      role: 'agent',
      agentCode: 'AGT 0412',
      agency: 'Arewa Prime Realty',
      status: 'active',
      createdAt: new Date().toISOString()
    },
    {
      id: 'USR-LANDLORD1',
      name: 'Joseph Danladi',
      email: 'landlord@kofa.ng',
      phone: '+2348032223344',
      password: hashPassword('landlord123'),
      role: 'landlord',
      status: 'active',
      createdAt: new Date().toISOString()
    },
    {
      id: 'USR-TENANT1',
      name: 'Maryam Idris',
      email: 'tenant@kofa.ng',
      phone: '+2348039998877',
      password: hashPassword('tenant123'),
      role: 'tenant',
      status: 'active',
      createdAt: new Date().toISOString()
    }
  ];

  db.data.users.push(...defaultUsers);
  db.flush();
}

function registerUser(body) {
  seedDefaultUsers();
  const { name, email, phone, password, role = 'tenant', agency = '' } = body;
  if (!name || !password || (!email && !phone)) {
    const err = new Error('Name, password, and email/phone are required');
    err.status = 400;
    throw err;
  }

  const cleanPhone = phone ? toE164(phone) : '';
  const cleanEmail = (email || '').trim().toLowerCase();

  // Check duplicate
  const exists = db.data.users.find(u =>
    (cleanEmail && u.email === cleanEmail) || (cleanPhone && u.phone === cleanPhone)
  );
  if (exists) {
    const err = new Error('An account with this email or phone number already exists.');
    err.status = 409;
    throw err;
  }

  const validRoles = ['tenant', 'landlord', 'agent'];
  const userRole = validRoles.includes(role) ? role : 'tenant';

  const user = {
    id: `USR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    name: name.trim(),
    email: cleanEmail,
    phone: cleanPhone,
    password: hashPassword(password),
    role: userRole,
    status: userRole === 'agent' ? 'pending_review' : 'active',
    agentCode: userRole === 'agent' ? `AGT ${crypto.randomInt(1000, 9999)}` : undefined,
    agency: userRole === 'agent' ? agency.trim() : undefined,
    createdAt: new Date().toISOString()
  };

  db.data.users.push(user);
  db.save();

  // Create session
  const token = createSession(user);
  return { user: sanitizeUser(user), token };
}

function loginUser(login, password) {
  seedDefaultUsers();
  const needle = String(login || '').trim().toLowerCase();
  const phoneNeedle = toE164(needle);

  const user = db.data.users.find(u =>
    u.email.toLowerCase() === needle || (phoneNeedle && u.phone === phoneNeedle) || u.phone === needle
  );

  if (!user || !verifyPassword(password, user.password)) {
    const err = new Error('Invalid email/phone or password.');
    err.status = 401;
    throw err;
  }

  const token = createSession(user);
  return { user: sanitizeUser(user), token };
}

function createSession(user) {
  if (!db.data.sessions) db.data.sessions = {};
  const token = crypto.randomBytes(24).toString('hex');
  db.data.sessions[token] = {
    userId: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    phone: user.phone,
    agentCode: user.agentCode,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() // 7 days
  };
  db.save();
  return token;
}

function getSession(token) {
  if (!token || !db.data.sessions) return null;
  const sess = db.data.sessions[token];
  if (!sess) return null;
  if (new Date(sess.expiresAt) < new Date()) {
    delete db.data.sessions[token];
    db.save();
    return null;
  }
  return sess;
}

function deleteSession(token) {
  if (token && db.data.sessions && db.data.sessions[token]) {
    delete db.data.sessions[token];
    db.save();
  }
}

function sanitizeUser(u) {
  const { password, ...safe } = u;
  return safe;
}

module.exports = {
  COOKIE_NAME,
  seedDefaultUsers,
  registerUser,
  loginUser,
  createSession,
  getSession,
  deleteSession,
  sanitizeUser,
  hashPassword,
};

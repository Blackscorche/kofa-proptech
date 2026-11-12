// USSD gateway for Africa's Talking → Kofa
// CON = continue (expect more input)   END = close session
//
// Clean Self-Service Flow:
//   DIAL *384*22898#
//   → Main menu (4 options)
//   → 1. Find a Home  → list all published homes
//   → Pick a number   → details & price
//   → 1. Book inspection → Pick slot (Morning/Afternoon/Evening)
//   → Enter Full Name (Auto-creates tenant account if new)
//   → Confirmed with Tracking ID & syncs straight to Agent dashboard

const db      = require('./db');
const rentify = require('./rentify');
const auth    = require('./auth');
const { toE164, toLocal } = require('./networks');

function naira(n) {
  if (n >= 1000000) return 'N' + (n / 1000000).toFixed(1).replace('.0', '') + 'm';
  if (n >= 1000)    return 'N' + Math.round(n / 1000) + 'k';
  return 'N' + n;
}

function mainMenu() {
  return [
    'CON Welcome to Kofa',
    '1. Find a home',
    '2. My inspections',
    '3. Report a problem',
    '4. Help & Info',
  ].join('\n');
}

async function handle(body) {
  const { phoneNumber, text = '' } = body;
  rentify.seed();

  const parts = text ? text.split('*') : [];
  const phone = toE164(phoneNumber) || phoneNumber;

  // ── Root menu ──────────────────────────────────────────
  if (!text) return mainMenu();

  const top = parts[0];

  // ══════════════════════════════════════════════════════
  // MENU 1 — FIND A HOME & INSPECT
  // ══════════════════════════════════════════════════════
  if (top === '1') {
    const homes = rentify.listPublic({});

    // Step 1 — list all homes
    if (parts.length === 1) {
      if (!homes.length) {
        return 'END No verified homes on Kofa yet.\nCheck back soon or visit kofa.ng';
      }
      const lines = ['CON Available homes on Kofa:'];
      homes.slice(0, 6).forEach((h, i) => {
        lines.push(`${i + 1}. ${h.bedrooms}bd ${h.type} - ${h.location} ${naira(h.price)}/yr`);
      });
      lines.push('0. Back');
      return lines.join('\n');
    }

    if (parts[1] === '0') return mainMenu();

    // Step 2 — user picked a home number
    const homeIdx = parseInt(parts[1], 10) - 1;
    const home = homes[homeIdx];
    if (!home) return 'END Invalid choice. Please redial.';

    const agent = (home.agents && home.agents[0]) || { name: 'Verified Agent', agentCode: 'AGT 0412' };

    if (parts.length === 2) {
      return [
        `CON ${home.bedrooms}-bed ${home.type}, ${home.location}`,
        `Price: ${naira(home.price)}/yr`,
        `Agent: ${agent.name} (${agent.agentCode})`,
        '1. Book inspection',
        '0. Back to list',
      ].join('\n');
    }

    if (parts[2] === '0') {
      const lines = ['CON Available homes on Kofa:'];
      homes.slice(0, 6).forEach((h, i) => {
        lines.push(`${i + 1}. ${h.bedrooms}bd ${h.type} - ${h.location} ${naira(h.price)}/yr`);
      });
      lines.push('0. Back');
      return lines.join('\n');
    }

    if (parts[2] !== '1') return 'END Invalid choice. Please redial.';

    // Step 3 — pick time slot
    if (parts.length === 3) {
      return [
        'CON When can you visit?',
        '1. Morning (8am-12pm)',
        '2. Afternoon (12pm-4pm)',
        '3. Evening (4pm-7pm)',
        '0. Back',
      ].join('\n');
    }

    if (parts[3] === '0') {
      return [
        `CON ${home.bedrooms}-bed ${home.type}, ${home.location}`,
        `Price: ${naira(home.price)}/yr`,
        `Agent: ${agent.name} (${agent.agentCode})`,
        '1. Book inspection',
        '0. Back to list',
      ].join('\n');
    }

    const timeMap = { '1': 'Morning (8am-12pm)', '2': 'Afternoon (12pm-4pm)', '3': 'Evening (4pm-7pm)' };
    const preferredTime = timeMap[parts[3]];
    if (!preferredTime) return 'END Invalid time slot selected. Please redial.';

    // Step 4 — ask for full name to auto-register account
    if (parts.length === 4) {
      return [
        'CON Please enter your Full Name',
        '(This creates your free tenant profile):',
      ].join('\n');
    }

    const rawName = (parts[4] || '').trim();
    const tenantName = rawName.length > 1 ? rawName : 'Phone User';

    // Auto-register user as tenant in DB if not already present
    if (!db.data.users) db.data.users = [];
    let user = db.data.users.find(u => u.phone === phone);
    if (!user) {
      user = {
        id: `USR-T${Date.now().toString().slice(-6)}`,
        name: tenantName,
        email: `${phone.replace('+', '')}@kofa.ng`,
        phone: phone,
        password: auth.hashPassword('tenant123'),
        role: 'tenant',
        status: 'active',
        createdAt: new Date().toISOString()
      };
      db.data.users.push(user);
    } else if (tenantName !== 'Phone User' && user.name === 'Phone User') {
      user.name = tenantName;
    }

    try {
      const booking = await rentify.bookInspection({
        propertyId:    home.id,
        publicationId: agent.id,
        tenantName:    user.name,
        tenantPhone:   phone,
        preferredTime,
        channel:       'USSD',
      });
      return [
        `END Inspection requested, ${user.name.split(' ')[0]}!`,
        `Ref: ${booking.trackingId}`,
        `Agent ${agent.agentCode} notified.`,
        'Log in at kofa.ng to track live.',
        'Default pass: tenant123',
      ].join('\n');
    } catch (e) {
      return `END ${e.message || 'Could not book. Please try again.'}`;
    }
  }

  // ══════════════════════════════════════════════════════
  // MENU 2 — MY INSPECTIONS
  // ══════════════════════════════════════════════════════
  if (top === '2') {
    const mine = (db.data.inspections || [])
      .filter(i => i.tenantPhone === phone)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (!mine.length) {
      return 'END You have no inspections yet.\nDial 1 to browse verified homes.';
    }

    if (parts.length === 1) {
      const lines = ['CON Your inspections:'];
      mine.slice(0, 5).forEach((ins, i) => {
        lines.push(`${i + 1}. ${ins.trackingId} - ${ins.status}`);
      });
      lines.push('0. Back');
      return lines.join('\n');
    }

    if (parts[1] === '0') return mainMenu();

    const ins = mine[parseInt(parts[1], 10) - 1];
    if (!ins) return 'END Invalid choice. Please redial.';

    return [
      `END Inspection ${ins.trackingId}`,
      `Property: ${ins.propertyTitle || ins.propertyId}`,
      `Agent: ${ins.agentName} (${ins.agentCode})`,
      `Time: ${ins.preferredTime}`,
      `Status: ${ins.status}`,
      ins.status === 'Confirmed' ? 'Visit Kofa website to pay safely.' : 'Agent has 24hrs to confirm.',
    ].join('\n');
  }

  // ══════════════════════════════════════════════════════
  // MENU 3 — REPORT A PROBLEM
  // ══════════════════════════════════════════════════════
  if (top === '3') {
    if (parts.length === 1) {
      return [
        'CON What happened?',
        '1. Agent asked for cash',
        '2. Property looks different',
        '3. Agent did not show up',
        '4. Other concern',
        '0. Back',
      ].join('\n');
    }

    if (parts[1] === '0') return mainMenu();

    const reasons = {
      '1': 'Agent asked for direct cash',
      '2': 'Property does not match photos',
      '3': 'Agent did not show up',
      '4': 'Other safety concern',
    };
    const reason = reasons[parts[1]];
    if (!reason) return 'END Invalid choice. Please redial.';

    if (!db.data.complaints) db.data.complaints = [];
    db.data.complaints.push({
      id: `CMP-${Date.now()}`,
      phone,
      reason,
      status: 'Open',
      createdAt: new Date().toISOString(),
    });
    db.save();

    return 'END Report received. Kofa Trust & Safety will\nreview this within 24 hours. Thank you.';
  }

  // ══════════════════════════════════════════════════════
  // MENU 4 — HELP
  // ══════════════════════════════════════════════════════
  if (top === '4') {
    return [
      'END Kofa Help:',
      'Find & book verified homes via USSD.',
      'Never pay rent before inspection.',
      'All payments go through Kofa escrow.',
      'Support: 0800-KOFA-NG',
    ].join('\n');
  }

  return mainMenu();
}

module.exports = { handle };

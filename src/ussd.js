// USSD gateway integration for Africa's Talking.
// Connects Africa's Talking POST { sessionId, serviceCode, phoneNumber, text }
// to Kofa's live property database and inspection booking.
// CON = continue session (ask for input)
// END = end session
const db = require('./db');
const rentify = require('./rentify');
const { toE164, toLocal } = require('./networks');

function formatNaira(n) {
  if (n >= 1000000) {
    const m = (n / 1000000).toFixed(1).replace('.0', '');
    return `N${m}m`;
  }
  if (n >= 1000) {
    const k = Math.round(n / 1000);
    return `N${k}k`;
  }
  return `N${n}`;
}

async function handle(body) {
  const { sessionId, serviceCode, phoneNumber, text = '' } = body;
  rentify.seed();

  const parts = text ? text.split('*') : [];
  const phone = toE164(phoneNumber) || phoneNumber;

  // Root menu
  if (parts.length === 0 || text === '') {
    return [
      'CON Welcome to Kofa',
      '1. Find a home',
      '2. My inspections',
      '3. Report a problem',
      '4. Help & Info',
    ].join('\n');
  }

  const top = parts[0];

  // ---------------- MENU 1: FIND A HOME ----------------
  if (top === '1') {
    // Step 1: Pick budget
    if (parts.length === 1) {
      return [
        'CON Rent for a year',
        '1. Up to N1m',
        '2. Up to N3m',
        '3. Up to N6m',
        '4. Any budget',
        '0. Back',
      ].join('\n');
    }

    if (parts[1] === '0') {
      return 'CON Welcome to Kofa\n1. Find a home\n2. My inspections\n3. Report a problem\n4. Help & Info';
    }

    const budgetChoice = parts[1];
    let maxBudget = Infinity;
    let budgetLabel = 'All homes';
    if (budgetChoice === '1') { maxBudget = 1000000; budgetLabel = 'Up to N1m'; }
    else if (budgetChoice === '2') { maxBudget = 3000000; budgetLabel = 'Up to N3m'; }
    else if (budgetChoice === '3') { maxBudget = 6000000; budgetLabel = 'Up to N6m'; }

    const availableHomes = rentify.listPublic({ maxPrice: maxBudget });

    // Step 2: Show matching homes
    if (parts.length === 2) {
      if (!availableHomes.length) {
        return `END No verified homes found under this budget.\nDial again or visit kofa.ng`;
      }
      const lines = [`CON Homes ${budgetLabel}`];
      availableHomes.slice(0, 4).forEach((h, idx) => {
        lines.push(`${idx + 1}. ${h.location} ${h.type} ${formatNaira(h.price)}`);
      });
      lines.push('0. Back');
      return lines.join('\n');
    }

    if (parts[2] === '0') {
      return 'CON Rent for a year\n1. Up to N1m\n2. Up to N3m\n3. Up to N6m\n4. Any budget\n0. Back';
    }

    const homeIndex = parseInt(parts[2], 10) - 1;
    const selectedHome = availableHomes[homeIndex];
    if (!selectedHome) {
      return 'END Invalid option selected. Please redial.';
    }

    // Step 3: Show property detail and agent
    const primaryAgent = (selectedHome.agents && selectedHome.agents[0]) || { name: 'Verified Agent', agentCode: 'AGT 0412' };

    if (parts.length === 3) {
      return [
        `CON ${selectedHome.bedrooms}-bed ${selectedHome.type}, ${selectedHome.location}`,
        `${formatNaira(selectedHome.price)} a year`,
        `Agent: ${primaryAgent.name}`,
        `${primaryAgent.agentCode}`,
        '1. Ask to inspect',
        '0. Back',
      ].join('\n');
    }

    if (parts[3] === '0') {
      const lines = [`CON Homes ${budgetLabel}`];
      availableHomes.slice(0, 4).forEach((h, idx) => {
        lines.push(`${idx + 1}. ${h.location} ${h.type} ${formatNaira(h.price)}`);
      });
      lines.push('0. Back');
      return lines.join('\n');
    }

    // Step 4: Pick preferred time
    if (parts.length === 4) {
      return [
        'CON When can you visit?',
        '1. Morning',
        '2. Afternoon',
        '3. Evening',
        '0. Back',
      ].join('\n');
    }

    if (parts[4] === '0') {
      return [
        `CON ${selectedHome.bedrooms}-bed ${selectedHome.type}, ${selectedHome.location}`,
        `${formatNaira(selectedHome.price)} a year`,
        `Agent: ${primaryAgent.name}`,
        `${primaryAgent.agentCode}`,
        '1. Ask to inspect',
        '0. Back',
      ].join('\n');
    }

    // Step 5: Complete Booking
    const times = { '1': 'Morning', '2': 'Afternoon', '3': 'Evening' };
    const preferredTime = times[parts[4]] || 'Afternoon';

    try {
      const booking = await rentify.bookInspection({
        propertyId: selectedHome.id,
        publicationId: primaryAgent.id,
        tenantName: 'Phone User',
        tenantPhone: phone,
        preferredTime,
        channel: 'USSD',
      });

      return [
        `END Request sent to ${primaryAgent.agentCode}!`,
        `Tracking ID: ${booking.trackingId}`,
        'They will confirm your visit time by SMS.',
        'Pay only through Kofa, after you inspect.',
      ].join('\n');
    } catch (e) {
      return `END ${e.message || 'Unable to book inspection at this time.'}`;
    }
  }

  // ---------------- MENU 2: MY INSPECTIONS ----------------
  if (top === '2') {
    const myInspections = (db.data.inspections || []).filter((i) => i.tenantPhone === phone);
    if (!myInspections.length) {
      return 'END You have no active inspections on Kofa.\nDial 1 to browse verified homes.';
    }

    const latest = myInspections[myInspections.length - 1];
    return [
      `END Latest Inspection:`,
      `ID: ${latest.trackingId}`,
      `Property: ${latest.propertyTitle}`,
      `Status: ${latest.status}`,
      `Agent: ${latest.agentName} (${latest.agentCode})`,
      latest.status === 'Done' ? 'Visit website to complete safe payment.' : 'Agent has 24h to confirm.',
    ].join('\n');
  }

  // ---------------- MENU 3: REPORT A PROBLEM ----------------
  if (top === '3') {
    if (parts.length === 1) {
      return [
        'CON Report a problem',
        '1. Agent asked for direct cash',
        '2. Property photos do not match',
        '3. Agent did not show up',
        '4. Other safety concern',
      ].join('\n');
    }

    const reportTypes = {
      '1': 'Agent asked for direct cash',
      '2': 'Property photos do not match',
      '3': 'Agent did not show up',
      '4': 'Other safety concern',
    };

    const complaint = {
      id: `CMP-${Date.now()}`,
      phone,
      reason: reportTypes[parts[1]] || 'General report',
      createdAt: new Date().toISOString(),
      status: 'Open',
    };
    db.data.complaints.push(complaint);
    db.save();

    return 'END Thank you. Your report has been logged with Kofa Trust & Safety. Our team will review it immediately.';
  }

  // ---------------- MENU 4: HELP ----------------
  if (top === '4') {
    return [
      'END Kofa Proptech Help:',
      'Browse verified homes via USSD or visit kofa.ng.',
      'Never pay rent directly to agents.',
      'Support helpline: 0800-KOFA-HELP',
    ].join('\n');
  }

  return 'END Invalid option selected. Please redial.';
}

module.exports = { handle };

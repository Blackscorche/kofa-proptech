// Core Proptech business logic for Kofa:
// Landlord private upload -> Agent selected publication -> 10% auto commission
// Unique Property Account Number -> Unique Inspection Tracking ID -> Escrow Payment
const crypto = require('crypto');
const db = require('./db');
const at = require('./africastalking');
const { toE164, toLocal } = require('./networks');

const COMMISSION_RATE = 0.10; // strictly 10%
const token = (prefix) => `${prefix}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const today = () => new Date().toISOString();

// Seed initial demo data — 1 landlord property (uploaded by demo landlord),
// published by demo agent, with 1 demo tenant inspection already booked.
function seed() {
  if (db.data.properties && db.data.properties.length > 0) return;

  // ── Single demo property owned by the demo landlord account ──
  const propId = 'PROP-DEMO01';
  const pubId  = 'PUB-DEMO01';

  db.data.properties.push({
    id: propId,
    title: '2-Bedroom Serviced Flat, Ungwan Boro',
    location: 'Ungwan Boro',
    city: 'Kaduna',
    bedrooms: 2,
    bathrooms: 2,
    type: 'Flat',
    originalRent: 800000,
    image: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=80',
    amenities: ['Fenced compound', 'Borehole water', 'Prepaid meter', 'Security post'],
    accountNumber: 'KOF-100001',
    landlordId:    'USR-LANDLORD1',
    landlordName:  'Joseph Danladi',      // matches demo landlord account
    landlordPhone: '+2348032223344',
    status: 'private',
    createdAt: today(),
  });

  // ── Demo agent publishes it ──
  db.data.publications.push({
    id: pubId,
    propertyId: propId,
    agentId:    'USR-AGENT1',
    agentCode:  'AGT 0412',
    agentName:  'Abubakar Sadiq',         // matches demo agent account
    agency:     'Arewa Prime Realty',
    agentPhone: '+2348030000001',
    rating: '4.9',
    status: 'published',
    createdAt: today(),
  });

  // ── Demo tenant has 1 booked inspection ──
  db.data.inspections.push({
    id:             'INS-DEMO01',
    trackingId:     'TRK-DEMO01',
    propertyId:     propId,
    publicationId:  pubId,
    propertyTitle:  '2-Bedroom Serviced Flat, Ungwan Boro',
    tenantId:       'USR-TENANT1',
    tenantName:     'Maryam Idris',       // matches demo tenant account
    tenantPhone:    '+2348039998877',
    agentId:        'USR-AGENT1',
    agentName:      'Abubakar Sadiq',
    agentCode:      'AGT 0412',
    agentPhone:     '+2348030000001',
    preferredTime:  'Saturday Morning',
    channel:        'Web',
    status:         'Requested',
    expiresAt:      new Date(Date.now() + 86400000).toISOString(),
    createdAt:      today(),
  });

  db.flush();
}

// Convert backend property record to public view
function publicProperty(p) {
  const publishedAgents = db.data.publications
    .filter((x) => x.propertyId === p.id && x.status === 'published')
    .map((x) => ({
      id: x.id,
      agentCode: x.agentCode || 'AGT ' + x.id.slice(-4),
      name: x.agentName,
      agency: x.agency,
      phone: x.agentPhone,
      rating: x.rating || '5.0',
    }));

  const commission = Math.round(p.originalRent * COMMISSION_RATE);
  const advertisedPrice = p.originalRent + commission;

  return {
    id: p.id,
    title: p.title,
    location: p.location,
    city: p.city,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    type: p.type,
    image: p.image,
    amenities: p.amenities || [],
    price: advertisedPrice,
    originalRent: p.originalRent,
    commissionAmount: commission,
    accountNumber: p.accountNumber,
    verified: true,
    agents: publishedAgents,
    agentCount: publishedAgents.length,
  };
}

// 1. Landlord Uploads a Property (Private to agents)
function createProperty(body) {
  const required = ['title', 'location', 'city', 'originalRent'];
  const missing = required.find((f) => !String(body[f] || '').trim());
  if (missing) {
    const err = new Error(`Please provide ${missing}.`);
    err.status = 400;
    throw err;
  }

  const rent = parseInt(String(body.originalRent).replace(/\D/g, ''), 10);
  if (!rent || rent <= 0) {
    const err = new Error('Please enter a valid rental amount.');
    err.status = 400;
    throw err;
  }

  // Automatic permanently linked Property Account Number
  const accountNumber = `KOF-${crypto.randomInt(100000, 999999)}`;
  const p = {
    id: token('PROP'),
    title: body.title.trim(),
    location: body.location.trim(),
    city: body.city.trim(),
    landlordName: (body.landlordName || 'Verified Landlord').trim(),
    landlordPhone: toE164(body.landlordPhone || '') || '',
    originalRent: rent,
    bedrooms: parseInt(body.bedrooms || '1', 10),
    bathrooms: parseInt(body.bathrooms || '1', 10),
    type: body.type || 'Flat',
    image: body.image || 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=80',
    amenities: Array.isArray(body.amenities) ? body.amenities : ['Verified owner', 'Water & Power', 'Security'],
    accountNumber,
    status: 'private', // private until agents publish
    createdAt: today(),
  };

  db.data.properties.push(p);
  db.save();

  return {
    ...p,
    advertisedPrice: Math.round(rent * (1 + COMMISSION_RATE)),
    message: 'Property uploaded. Assigned Property Account Number ' + accountNumber + '. Now available in Agent Pool.',
  };
}

// 2 & 3. Agents View Available Pool & Repost Property
function publishProperty(propertyId, agentData) {
  const p = db.data.properties.find((x) => x.id === propertyId);
  if (!p) {
    const err = new Error('Property record not found.');
    err.status = 404;
    throw err;
  }

  // Check if this agent already published this property
  const existing = db.data.publications.find(
    (x) => x.propertyId === propertyId && x.agentPhone === toE164(agentData.agentPhone || '') && x.status === 'published'
  );
  if (existing) {
    return { publication: existing, message: 'You have already published this property.' };
  }

  const agentCode = agentData.agentCode || `AGT ${crypto.randomInt(1000, 9999)}`;
  const publication = {
    id: token('PUB'),
    propertyId: p.id,
    agentCode,
    agentName: agentData.agentName || 'Kofa Verified Agent',
    agency: agentData.agency || 'Independent Agent',
    agentPhone: toE164(agentData.agentPhone || '') || '+2348000000000',
    rating: agentData.rating || '4.9',
    status: 'published',
    createdAt: today(),
  };

  db.data.publications.push(publication);
  db.save();

  return {
    publication,
    property: publicProperty(p),
    message: `Property published successfully under ${agentCode}. Advertised at ₦${(Math.round(p.originalRent * 1.1)).toLocaleString()}.`,
  };
}

// 4. Public Properties Search & Filter (Only properties with active agent publications)
function listPublic({ city, type, bedrooms, maxPrice, minPrice, q } = {}) {
  seed();
  let props = db.data.properties.filter((p) =>
    db.data.publications.some((pub) => pub.propertyId === p.id && pub.status === 'published')
  );

  if (city) {
    const c = city.toLowerCase();
    props = props.filter((p) => p.city.toLowerCase().includes(c) || p.location.toLowerCase().includes(c));
  }
  if (type) {
    props = props.filter((p) => p.type.toLowerCase() === type.toLowerCase());
  }
  if (bedrooms) {
    props = props.filter((p) => p.bedrooms >= parseInt(bedrooms, 10));
  }
  if (maxPrice) {
    const max = parseInt(maxPrice, 10);
    props = props.filter((p) => Math.round(p.originalRent * (1 + COMMISSION_RATE)) <= max);
  }
  if (minPrice) {
    const min = parseInt(minPrice, 10);
    props = props.filter((p) => Math.round(p.originalRent * (1 + COMMISSION_RATE)) >= min);
  }
  if (q) {
    const query = q.toLowerCase();
    props = props.filter((p) =>
      `${p.title} ${p.location} ${p.city} ${p.type} ${p.accountNumber}`.toLowerCase().includes(query)
    );
  }

  return props.map(publicProperty);
}

// 5. Tenant Request Inspection (Generates Unique Tracking ID)
async function bookInspection({ propertyId, publicationId, tenantName, tenantPhone, preferredTime, channel = 'Web' }) {
  seed();
  const prop = db.data.properties.find((p) => p.id === propertyId || p.accountNumber === propertyId);
  if (!prop) {
    const err = new Error('Property not found.');
    err.status = 404;
    throw err;
  }

  // Find publication or default to first active
  let pub = db.data.publications.find((x) => (x.id === publicationId || x.agentCode === publicationId) && x.propertyId === prop.id && x.status === 'published');
  if (!pub) {
    pub = db.data.publications.find((x) => x.propertyId === prop.id && x.status === 'published');
  }
  if (!pub) {
    const err = new Error('No active agent listing for this property.');
    err.status = 400;
    throw err;
  }

  const phone = toE164(tenantPhone);
  if (!phone) {
    const err = new Error('A valid Nigerian phone number is required (+234 / 080...).');
    err.status = 400;
    throw err;
  }

  // Tenant cancellation rule & active inspection check:
  // A tenant can only have one active inspection for the same property at a time.
  const activeExisting = db.data.inspections.find(
    (i) => i.propertyId === prop.id && i.tenantPhone === phone && ['Requested', 'Confirmed'].includes(i.status)
  );
  if (activeExisting) {
    const err = new Error(`You already have an active request (${activeExisting.trackingId}) with ${activeExisting.agentName}. Cancel it first before booking another.`);
    err.status = 409;
    throw err;
  }

  // Count past cancellations for this tenant & property (max 3 allowed)
  const cancellationCount = db.data.inspections.filter(
    (i) => i.propertyId === prop.id && i.tenantPhone === phone && i.status === 'Cancelled'
  ).length;
  if (cancellationCount >= 3) {
    const err = new Error('You have cancelled 3 times on this property. Please contact Kofa support to proceed.');
    err.status = 403;
    throw err;
  }

  const trackingId = `TRK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString(); // 24hr expiry

  const inspection = {
    id: token('INS'),
    trackingId,
    propertyId: prop.id,
    propertyAccountNumber: prop.accountNumber,
    propertyTitle: prop.title,
    propertyLocation: `${prop.location}, ${prop.city}`,
    publicationId: pub.id,
    agentCode: pub.agentCode,
    agentName: pub.agentName,
    agentPhone: pub.agentPhone,
    tenantName: (tenantName || 'Prospective Tenant').trim(),
    tenantPhone: phone,
    preferredTime: preferredTime || 'Afternoon',
    channel,
    status: 'Requested',
    price: Math.round(prop.originalRent * (1 + COMMISSION_RATE)),
    expiresAt,
    createdAt: today(),
    updatedAt: today(),
  };

  db.data.inspections.push(inspection);
  db.save();

  // Send SMS confirmation to both tenant and agent via Africa's Talking
  const tenantMsg = `Kofa: Inspection ${trackingId} booked for ${prop.title}. Agent: ${pub.agentName} (${pub.agentCode}). Pay only via Kofa after inspection.`;
  const agentMsg = `Kofa Alert: New inspection ${trackingId} for ${prop.title} by ${inspection.tenantName} (${toLocal(phone)}). You have 24h to confirm or decline.`;

  at.sendSms([phone], tenantMsg).catch((e) => console.warn('Tenant SMS failed:', e.message));
  at.sendSms([pub.agentPhone], agentMsg).catch((e) => console.warn('Agent SMS failed:', e.message));

  return inspection;
}

// 6. Inspection Status Transitions (Requested -> Confirmed -> Done -> Paid | Cancelled | Declined)
function updateInspectionStatus(trackingId, newStatus, actorPhone = null) {
  const inspection = db.data.inspections.find((i) => i.trackingId === trackingId);
  if (!inspection) {
    const err = new Error(`Inspection ${trackingId} not found.`);
    err.status = 404;
    throw err;
  }

  const validTransitions = {
    Requested: ['Confirmed', 'Declined', 'Cancelled'],
    Confirmed: ['Done', 'Cancelled'],
    Done: ['Paid'],
    Declined: [],
    Cancelled: [],
    Paid: ['Closed'],
    Expired: [],
    Closed: [],
  };

  const current = inspection.status;
  if (!validTransitions[current] || !validTransitions[current].includes(newStatus)) {
    const err = new Error(`Cannot change inspection status from ${current} to ${newStatus}.`);
    err.status = 409;
    throw err;
  }

  inspection.status = newStatus;
  inspection.updatedAt = today();
  db.save();

  // Trigger SMS notifications for key lifecycle events
  if (newStatus === 'Confirmed') {
    const msg = `Kofa: Agent ${inspection.agentName} has confirmed your inspection ${trackingId} for ${inspection.propertyTitle}. Check dashboard for contact details.`;
    at.sendSms([inspection.tenantPhone], msg).catch(() => {});
  } else if (newStatus === 'Done') {
    const msg = `Kofa: Physical inspection ${trackingId} marked Done. Rental agreement ready. You can now safely pay through the platform.`;
    at.sendSms([inspection.tenantPhone], msg).catch(() => {});
  }

  return inspection;
}

// 7. Temporary Checkout Reservation to Prevent Double Payment (15-30 mins lock)
const checkoutReservations = new Map(); // propertyId -> { trackingId, expiresAt }

function reserveForCheckout(trackingId) {
  const inspection = db.data.inspections.find((i) => i.trackingId === trackingId);
  if (!inspection) {
    const err = new Error('Inspection not found.');
    err.status = 404;
    throw err;
  }
  if (inspection.status !== 'Done') {
    const err = new Error('Payment is only allowed after the inspection is marked Done.');
    err.status = 409;
    throw err;
  }

  const nowMs = Date.now();
  const existingLock = checkoutReservations.get(inspection.propertyId);
  if (existingLock && existingLock.expiresAt > nowMs && existingLock.trackingId !== trackingId) {
    const waitMins = Math.ceil((existingLock.expiresAt - nowMs) / 60000);
    const err = new Error(`Another tenant is currently completing checkout for this property. Reserved for ${waitMins} more minutes.`);
    err.status = 423; // Locked
    throw err;
  }

  // Lock for 20 minutes
  const lockExpires = nowMs + 20 * 60 * 1000;
  checkoutReservations.set(inspection.propertyId, { trackingId, expiresAt: lockExpires });

  return {
    reserved: true,
    trackingId,
    propertyId: inspection.propertyId,
    expiresAt: new Date(lockExpires).toISOString(),
  };
}

// 8. Payment & Commission Separation
function processPayment(trackingId) {
  const inspection = db.data.inspections.find((i) => i.trackingId === trackingId);
  if (!inspection) {
    const err = new Error('Inspection not found.');
    err.status = 404;
    throw err;
  }
  if (inspection.status !== 'Done') {
    const err = new Error('Payment is only allowed after physical inspection is marked Done.');
    err.status = 409;
    throw err;
  }

  // Check if duplicate payment
  if (db.data.payments.some((p) => p.trackingId === trackingId && p.status === 'Confirmed')) {
    const err = new Error('This inspection has already been paid for.');
    err.status = 409;
    throw err;
  }

  const prop = db.data.properties.find((p) => p.id === inspection.propertyId);
  if (!prop) {
    const err = new Error('Property no longer exists.');
    err.status = 404;
    throw err;
  }

  // Calculate separate split
  const originalRent = prop.originalRent;
  const agentCommission = Math.round(originalRent * COMMISSION_RATE);
  const totalPaid = originalRent + agentCommission;

  const paymentRecord = {
    id: token('PAY'),
    trackingId,
    propertyId: prop.id,
    propertyAccountNumber: prop.accountNumber,
    agentCode: inspection.agentCode,
    agentName: inspection.agentName,
    agentPhone: inspection.agentPhone,
    tenantName: inspection.tenantName,
    tenantPhone: inspection.tenantPhone,
    landlordRent: originalRent,
    agentCommission: agentCommission,
    total: totalPaid,
    status: 'In Escrow', // Commission released after tenant confirms keys/occupancy
    createdAt: today(),
  };

  db.data.payments.push(paymentRecord);

  // Update inspection status
  inspection.status = 'Paid';
  inspection.updatedAt = today();

  // Mark property as rented & close any other open inspection requests for this property
  prop.status = 'rented';
  db.data.inspections
    .filter((i) => i.propertyId === prop.id && i.trackingId !== trackingId && ['Requested', 'Confirmed'].includes(i.status))
    .forEach((i) => {
      i.status = 'Closed';
      i.closedReason = 'Rented by another tenant';
    });

  // Clear checkout reservation lock
  checkoutReservations.delete(prop.id);
  db.save();

  // Dispatch Africa's Talking SMS receipts
  const tenantReceipt = `Kofa Receipt: Payment of ₦${totalPaid.toLocaleString()} received for ${prop.title}. Ref: ${paymentRecord.id}. Funds in secure escrow.`;
  const agentAlert = `Kofa Alert: Rent paid for ${prop.title}! Commission of ₦${agentCommission.toLocaleString()} held in escrow for ${inspection.agentCode}.`;
  const landlordAlert = `Kofa Alert: Rent of ₦${originalRent.toLocaleString()} secured for your property ${prop.title} (${prop.accountNumber}).`;

  at.sendSms([inspection.tenantPhone], tenantReceipt).catch(() => {});
  at.sendSms([inspection.agentPhone], agentAlert).catch(() => {});
  if (prop.landlordPhone) {
    at.sendSms([prop.landlordPhone], landlordAlert).catch(() => {});
  }

  return paymentRecord;
}

// 9. Release Commission (Admin or Tenant Confirmation)
function releaseCommission(paymentId) {
  const payment = db.data.payments.find((p) => p.id === paymentId || p.trackingId === paymentId);
  if (!payment) {
    const err = new Error('Payment not found.');
    err.status = 404;
    throw err;
  }
  payment.status = 'Released';
  payment.releasedAt = today();
  db.save();

  const msg = `Kofa Commission Released: ₦${payment.agentCommission.toLocaleString()} has been disbursed for inspection ${payment.trackingId}.`;
  at.sendSms([payment.agentPhone], msg).catch(() => {});

  return payment;
}

module.exports = {
  COMMISSION_RATE,
  seed,
  publicProperty,
  createProperty,
  publishProperty,
  listPublic,
  bookInspection,
  updateInspectionStatus,
  reserveForCheckout,
  processPayment,
  releaseCommission,
};

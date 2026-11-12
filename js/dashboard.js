/**
 * Kofa Dashboard Live Data Bridge
 * Fetches real data from the API and injects it into every dashboard page.
 * Zero external dependencies.
 */
(function () {
  'use strict';

  /* ── helpers ── */
  function fmt(n) {
    return '₦' + Number(n || 0).toLocaleString('en-NG');
  }
  function ago(iso) {
    if (!iso) return '';
    const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
    return d === 0 ? 'Today' : d === 1 ? 'Yesterday' : d + ' days ago';
  }
  function chip(status) {
    const map = {
      Requested: 'chip-amber', Confirmed: 'chip-green', Done: 'chip-blue',
      Cancelled: 'chip-red', published: 'chip-green', private: 'chip-amber',
    };
    return `<span class="chip ${map[status] || 'chip-amber'}">${status}</span>`;
  }
  async function api(path) {
    try {
      const r = await fetch(path);
      if (!r.ok) return null;
      return r.json();
    } catch { return null; }
  }
  function set(sel, html) {
    const el = document.querySelector(sel);
    if (el) el.innerHTML = html;
  }
  function setText(sel, text) {
    const el = document.querySelector(sel);
    if (el) el.textContent = text;
  }

  /* ── detect role from URL path ── */
  const path = location.pathname;
  const role = path.includes('/agent/') ? 'agent'
    : path.includes('/landlord/') ? 'landlord'
    : path.includes('/tenant/') ? 'tenant'
    : path.includes('/admin/') ? 'admin'
    : null;

  if (!role) return; // homepage or login — skip

  /* ── get current user ── */
  api('/api/auth/me').then(me => {
    if (me && me.user) {
      // Update sidebar name if present
      const nameEls = document.querySelectorAll('.side-user strong, .page-head h1');
      nameEls.forEach(el => {
        if (el.classList.contains('page-head') || el.closest('.page-head')) {
          el.textContent = `Hello, ${me.user.name.split(' ')[0]} 👋`;
        } else {
          el.textContent = me.user.name;
        }
      });
    }
  });

  /* ══════════════════════════════════════
     AGENT DASHBOARD
  ══════════════════════════════════════ */
  if (role === 'agent') {
    Promise.all([
      api('/api/agent/pool'),
      api('/api/agent/inspections'),
      api('/api/admin/overview'),
    ]).then(([poolData, inspData, overview]) => {
      const pool = poolData?.pool || [];
      const inspections = inspData?.inspections || [];
      const stats = overview?.stats || {};

      // Stats
      const myPublished = pool.filter(p => p.status === 'published').length;
      const newInspections = inspections.filter(i => i.status === 'Requested').length;
      const payments = overview?.payments || [];
      const heldComm = payments.filter(p => !p.commissionReleased).reduce((a, p) => a + (p.agentCommission || 0), 0);
      const relComm = payments.filter(p => p.commissionReleased).reduce((a, p) => a + (p.agentCommission || 0), 0);

      const statEls = document.querySelectorAll('.stat .v');
      if (statEls[0]) statEls[0].textContent = myPublished;
      if (statEls[1]) statEls[1].textContent = newInspections;
      if (statEls[2]) statEls[2].textContent = fmt(heldComm);
      if (statEls[3]) statEls[3].textContent = fmt(relComm);

      // Badge on nav
      const badge = document.querySelector('.side-nav .badge');
      if (badge) badge.textContent = newInspections;

      // Pool preview (latest 3)
      const poolRows = pool.slice(0, 3).map(p => `
        <li>
          <div class="grow">
            <strong><a href="pool-item.html?id=${p.id}">${p.title}</a></strong>
            <span class="muted small">Landlord rent ${fmt(p.originalRent)} → public ${fmt(p.price)}</span>
          </div>
          ${chip(p.status)}
        </li>`).join('') || '<li><span class="muted">No properties in pool yet.</span></li>';

      const poolCard = document.querySelectorAll('.card')[0];
      if (poolCard) {
        const ul = poolCard.querySelector('ul.rows');
        if (ul) ul.innerHTML = poolRows;
      }

      // Inspection requests preview (latest 3)
      const inspRows = inspections.slice(0, 3).map(i => `
        <li>
          <div class="grow">
            <strong>${i.tenantName || 'Tenant'}</strong>
            <span class="muted small">${i.propertyId} · ${i.preferredTime || ''} · Ref: ${i.trackingId}</span>
          </div>
          ${chip(i.status)}
        </li>`).join('') || '<li><span class="muted">No inspection requests yet.</span></li>';

      const inspCard = document.querySelectorAll('.card')[1];
      if (inspCard) {
        const ul = inspCard.querySelector('ul.rows');
        if (ul) ul.innerHTML = inspRows;
      }
    });
  }

  /* ══════════════════════════════════════
     LANDLORD DASHBOARD
  ══════════════════════════════════════ */
  if (role === 'landlord') {
    Promise.all([
      api('/api/landlord/properties'),
      api('/api/admin/overview'),
    ]).then(([propData, overview]) => {
      const props = propData?.properties || [];
      const payments = overview?.payments || [];
      const inspections = overview?.inspections || [];

      const published = props.filter(p => (p.publishedCount || 0) > 0);
      const rentCollected = payments.reduce((a, p) => a + (p.landlordRent || 0), 0);
      const pending = inspections.filter(i => i.status === 'Requested' || i.status === 'Confirmed').length;

      const statEls = document.querySelectorAll('.stat .v');
      if (statEls[0]) statEls[0].textContent = props.length;
      if (statEls[1]) statEls[1].textContent = published.length;
      if (statEls[2]) statEls[2].textContent = fmt(rentCollected);
      if (statEls[3]) statEls[3].textContent = pending;

      // Properties list
      const propRows = props.slice(0, 4).map(p => `
        <li>
          <div class="grow">
            <strong>${p.title}</strong>
            <span class="muted small">${fmt(p.originalRent)}/yr · ${p.publishedCount || 0} agent(s) listed</span>
          </div>
          ${chip(p.publishedCount > 0 ? 'published' : 'private')}
        </li>`).join('') || '<li><span class="muted">No properties yet. <a href="add-property.html">Add one</a></span></li>';

      const card = document.querySelector('.card ul.rows');
      if (card) card.innerHTML = propRows;
    });
  }

  /* ══════════════════════════════════════
     TENANT DASHBOARD
  ══════════════════════════════════════ */
  if (role === 'tenant') {
    Promise.all([
      api('/api/properties'),
      api('/api/agent/inspections'), // tenants share inspection endpoint
    ]).then(([propData, inspData]) => {
      const props = Array.isArray(propData) ? propData : (propData?.properties || []);
      const inspections = inspData?.inspections || [];

      const upcoming = inspections.filter(i => ['Requested', 'Confirmed'].includes(i.status));
      const done = inspections.filter(i => i.status === 'Done');

      const statEls = document.querySelectorAll('.stat .v');
      if (statEls[0]) statEls[0].textContent = props.length;
      if (statEls[1]) statEls[1].textContent = upcoming.length;
      if (statEls[2]) statEls[2].textContent = done.length;

      // Upcoming inspections
      const rows = upcoming.slice(0, 3).map(i => `
        <li>
          <div class="grow">
            <strong>${i.propertyId}</strong>
            <span class="muted small">${i.preferredTime || 'Time TBC'} · Ref: ${i.trackingId}</span>
          </div>
          ${chip(i.status)}
        </li>`).join('') || '<li><span class="muted">No upcoming inspections. <a href="../index.html">Browse listings</a></span></li>';

      const card = document.querySelector('.card ul.rows');
      if (card) card.innerHTML = rows;

      // Live listings preview
      const listingRows = props.slice(0, 3).map(p => `
        <li>
          <div class="grow">
            <strong><a href="../listing.html?id=${p.id}">${p.title}</a></strong>
            <span class="muted small">${fmt(p.price)}/yr · ${p.location}, ${p.city} · ${p.bedrooms}bd</span>
          </div>
          <span class="chip chip-green">Live</span>
        </li>`).join('') || '<li><span class="muted">No listings available yet.</span></li>';

      const cards = document.querySelectorAll('.card ul.rows');
      if (cards[1]) cards[1].innerHTML = listingRows;
    });
  }

  /* ══════════════════════════════════════
     ADMIN DASHBOARD
  ══════════════════════════════════════ */
  if (role === 'admin') {
    api('/api/admin/overview').then(data => {
      if (!data) return;
      const { stats, payments, inspections, properties } = data;

      // Stats
      const statEls = document.querySelectorAll('.stat .v');
      if (statEls[0]) statEls[0].textContent = stats.totalProperties;
      if (statEls[1]) statEls[1].textContent = stats.publishedListings;
      if (statEls[2]) statEls[2].textContent = stats.inspections;
      if (statEls[3]) statEls[3].textContent = fmt(stats.totalRentCollected);
      if (statEls[4]) statEls[4].textContent = fmt(stats.totalCommission);
      if (statEls[5]) statEls[5].textContent = stats.payments;

      // Recent payments
      const payRows = (payments || []).slice(0, 5).map(p => `
        <tr>
          <td>${p.trackingId || p.id}</td>
          <td>${fmt(p.landlordRent)}</td>
          <td>${fmt(p.agentCommission)}</td>
          <td>${chip(p.commissionReleased ? 'Done' : 'Requested')}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="muted">No payments yet.</td></tr>';

      const payTable = document.querySelector('table tbody');
      if (payTable) payTable.innerHTML = payRows;

      // Recent inspections
      const inspRows = (inspections || []).slice(0, 5).map(i => `
        <li>
          <div class="grow">
            <strong>${i.trackingId}</strong>
            <span class="muted small">${i.tenantName || ''} · ${i.propertyId} · ${i.preferredTime || ''}</span>
          </div>
          ${chip(i.status)}
        </li>`).join('') || '<li><span class="muted">No inspections yet.</span></li>';

      const cards = document.querySelectorAll('.card ul.rows');
      if (cards[0]) cards[0].innerHTML = inspRows;

      // Properties table
      const propRows = (properties || []).slice(0, 5).map(p => `
        <li>
          <div class="grow">
            <strong>${p.title}</strong>
            <span class="muted small">${fmt(p.originalRent)}/yr · ${p.city}</span>
          </div>
          ${chip(p.status)}
        </li>`).join('') || '<li><span class="muted">No properties.</span></li>';

      if (cards[1]) cards[1].innerHTML = propRows;
    });
  }

  /* ══════════════════════════════════════
     POOL PAGE (agent/pool.html)
  ══════════════════════════════════════ */
  if (path.includes('pool.html')) {
    api('/api/agent/pool').then(data => {
      const pool = data?.pool || [];
      const rows = pool.map(p => `
        <li>
          <div class="thumb"><div class="photo" style="background:url('${p.image}') center/cover no-repeat" role="img" aria-label="${p.title}"></div></div>
          <div class="grow">
            <strong><a href="pool-item.html?id=${p.id}">${p.title}</a></strong>
            <span class="muted small">${p.bedrooms}bd · ${p.location}, ${p.city}</span>
            <span class="muted small">Landlord ${fmt(p.originalRent)} → You advertise at ${fmt(p.price)}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
            ${chip(p.status)}
            <button class="btn btn-sm btn-primary pub-btn" data-id="${p.id}" style="font-size:0.75rem;padding:4px 10px">Publish</button>
          </div>
        </li>`).join('') || '<li><span class="muted">No properties in the pool yet.</span></li>';

      const ul = document.querySelector('ul.rows');
      if (ul) ul.innerHTML = rows;

      // Publish button handler
      document.querySelectorAll('.pub-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.textContent = 'Publishing…';
          btn.disabled = true;
          const r = await fetch(`/api/agent/publish/${btn.dataset.id}`, { method: 'POST' });
          const d = await r.json();
          if (r.ok) {
            btn.textContent = '✅ Published';
            btn.closest('li').querySelector('.chip').outerHTML = chip('published');
          } else {
            btn.textContent = d.error || 'Error';
            btn.disabled = false;
          }
        });
      });
    });
  }

  /* ══════════════════════════════════════
     INSPECTIONS PAGE (agent/inspections.html, tenant/inspections.html)
  ══════════════════════════════════════ */
  if (path.includes('inspections.html')) {
    api('/api/agent/inspections').then(data => {
      const list = data?.inspections || [];
      const rows = list.map(i => `
        <li>
          <div class="grow">
            <strong>${i.trackingId}</strong>
            <span class="muted small">${i.tenantName || ''} · ${i.tenantPhone || ''}</span>
            <span class="muted small">Property: ${i.propertyId} · ${i.preferredTime || 'No time set'}</span>
          </div>
          ${chip(i.status)}
          <div style="display:flex;gap:6px;margin-top:4px">
            <button class="btn btn-sm upd-btn" data-id="${i.trackingId}" data-st="Confirmed" style="font-size:0.75rem;padding:4px 8px">Confirm</button>
            <button class="btn btn-sm upd-btn" data-id="${i.trackingId}" data-st="Done" style="font-size:0.75rem;padding:4px 8px">Mark Done</button>
          </div>
        </li>`).join('') || '<li><span class="muted">No inspections yet.</span></li>';

      const ul = document.querySelector('ul.rows');
      if (ul) ul.innerHTML = rows;

      document.querySelectorAll('.upd-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const r = await fetch(`/api/inspections/${btn.dataset.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: btn.dataset.st }),
          });
          if (r.ok) location.reload();
        });
      });
    });
  }

  /* ══════════════════════════════════════
     LANDLORD PROPERTIES PAGE
  ══════════════════════════════════════ */
  if (path.includes('landlord/properties.html')) {
    api('/api/landlord/properties').then(data => {
      const props = data?.properties || [];
      const rows = props.map(p => `
        <li>
          <div class="grow">
            <strong>${p.title}</strong>
            <span class="muted small">${fmt(p.originalRent)}/yr · ${p.city} · ${p.bedrooms}bd ${p.bathrooms}ba</span>
            <span class="muted small">ID: ${p.id} · ${p.publishedCount || 0} agent publication(s)</span>
          </div>
          ${chip(p.publishedCount > 0 ? 'published' : 'private')}
        </li>`).join('') || '<li><span class="muted">No properties yet. <a href="add-property.html">Add one →</a></span></li>';

      const ul = document.querySelector('ul.rows');
      if (ul) ul.innerHTML = rows;
    });
  }

  /* ══════════════════════════════════════
     ADMIN OVERVIEW: inject real-time stats banner
  ══════════════════════════════════════ */
  if (role === 'admin') {
    // Add a live-refresh banner
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#10243A;color:#fff;padding:8px 14px;border-radius:8px;font-size:0.75rem;opacity:0.85;z-index:999';
    banner.textContent = '🟢 Live data — refreshes on page load';
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 4000);
  }

})();

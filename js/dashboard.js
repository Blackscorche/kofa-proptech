/**
 * Kofa Dashboard Live Data Bridge
 * Connects Agent, Landlord, Tenant, and Admin views with live API operations.
 */
(function () {
  'use strict';

  /* ── helpers ── */
  function fmt(n) {
    return '₦' + Number(n || 0).toLocaleString('en-NG');
  }
  function chip(status) {
    const map = {
      Requested: 'chip-amber',
      Confirmed: 'chip-green',
      Done: 'chip-blue',
      Declined: 'chip-red',
      Cancelled: 'chip-red',
      published: 'chip-green',
      private: 'chip-amber',
    };
    return `<span class="chip ${map[status] || 'chip-amber'}">${status}</span>`;
  }
  async function api(path, options) {
    try {
      const r = await fetch(path, options);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return { error: err.error || 'Failed' };
      }
      return r.json();
    } catch (e) {
      return { error: e.message };
    }
  }

  /* ── detect role ── */
  const path = location.pathname;
  const role = path.includes('/agent/') ? 'agent'
    : path.includes('/landlord/') ? 'landlord'
    : path.includes('/tenant/') ? 'tenant'
    : path.includes('/admin/') ? 'admin'
    : null;

  if (!role) return;

  // Greet user
  api('/api/auth/me').then(me => {
    if (me && me.user) {
      document.querySelectorAll('.side-user strong').forEach(el => el.textContent = me.user.name);
      const head = document.querySelector('.page-head h1');
      if (head && head.textContent.startsWith('Hello')) {
        head.textContent = `Hello, ${me.user.name.split(' ')[0]}`;
      }
    }
  });

  /* ══════════════════════════════════════
     AGENT DASHBOARD OVERVIEW & ACTIONS
  ══════════════════════════════════════ */
  if (role === 'agent') {
    Promise.all([
      api('/api/agent/pool'),
      api('/api/agent/inspections'),
      api('/api/admin/overview')
    ]).then(([poolData, inspData, overview]) => {
      const pool = poolData?.pool || [];
      const inspections = inspData?.inspections || [];
      const stats = overview?.stats || {};

      const myPublished = pool.filter(p => p.status === 'published').length;
      const newInspections = inspections.filter(i => i.status === 'Requested').length;

      const statEls = document.querySelectorAll('.stat .v');
      if (statEls[0]) statEls[0].textContent = myPublished;
      if (statEls[1]) statEls[1].textContent = newInspections;

      const badge = document.querySelector('.side-nav .badge');
      if (badge) badge.textContent = newInspections;

      // Render Inspection requests preview with real Accept / Decline handlers
      const inspCard = document.querySelectorAll('.card')[1];
      if (inspCard) {
        const ul = inspCard.querySelector('ul.rows');
        if (ul) {
          ul.innerHTML = inspections.slice(0, 5).map(i => `
            <li data-track="${i.trackingId}">
              <div class="grow">
                <strong>${i.tenantName || 'Tenant'} (${i.tenantPhone})</strong>
                <span class="muted small">${i.propertyTitle || i.propertyId} · ${i.preferredTime} · Ref: ${i.trackingId}</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                ${chip(i.status)}
                ${i.status === 'Requested' ? `
                  <button class="btn btn-sm btn-plate act-btn" data-track="${i.trackingId}" data-st="Confirmed">Accept</button>
                  <button class="btn btn-sm btn-danger act-btn" data-track="${i.trackingId}" data-st="Declined">Decline</button>
                ` : i.status === 'Confirmed' ? `
                  <button class="btn btn-sm act-btn" data-track="${i.trackingId}" data-st="Done">Mark Done</button>
                ` : ''}
              </div>
            </li>
          `).join('') || '<li><span class="muted">No inspection requests yet.</span></li>';

          bindStatusButtons(ul);
        }
      }
    });
  }

  /* ══════════════════════════════════════
     AGENT INSPECTIONS PAGE (inspections.html)
  ══════════════════════════════════════ */
  if (path.includes('agent/inspections.html')) {
    api('/api/agent/inspections').then(data => {
      const list = data?.inspections || [];
      const tbody = document.querySelector('table.table tbody');
      if (tbody) {
        tbody.innerHTML = list.map(i => `
          <tr data-track="${i.trackingId}">
            <td>
              <span class="cell-main">${i.tenantName || 'Tenant'}</span>
              <span class="cell-sub">${i.tenantPhone}</span>
            </td>
            <td>${i.propertyTitle || i.propertyId}</td>
            <td>${i.preferredTime || 'Anytime'}</td>
            <td>${chip(i.status)}</td>
            <td>
              <div class="actions">
                ${i.status === 'Requested' ? `
                  <button class="btn btn-plate btn-sm act-btn" data-track="${i.trackingId}" data-st="Confirmed">Accept</button>
                  <button class="btn btn-danger btn-sm act-btn" data-track="${i.trackingId}" data-st="Declined">Decline</button>
                ` : i.status === 'Confirmed' ? `
                  <button class="btn btn-plate btn-sm act-btn" data-track="${i.trackingId}" data-st="Done">Mark Done</button>
                  <button class="btn btn-danger btn-sm act-btn" data-track="${i.trackingId}" data-st="Declined">Cancel</button>
                ` : `<span class="muted small">${i.status}</span>`}
              </div>
            </td>
          </tr>
        `).join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">No inspections yet.</td></tr>';

        bindStatusButtons(tbody);
      }
    });
  }

  function bindStatusButtons(container) {
    container.querySelectorAll('.act-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const trk = btn.dataset.track;
        const st = btn.dataset.st;
        btn.disabled = true;
        btn.textContent = '...';

        const res = await api(`/api/inspections/${trk}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: st })
        });

        if (res.error) {
          alert('Update error: ' + res.error);
          btn.disabled = false;
        } else {
          location.reload();
        }
      });
    });
  }

  /* ══════════════════════════════════════
     LANDLORD PROPERTIES & OVERVIEW
  ══════════════════════════════════════ */
  if (role === 'landlord') {
    Promise.all([
      api('/api/landlord/properties'),
      api('/api/admin/overview')
    ]).then(([propData, overview]) => {
      const props = propData?.properties || [];
      const inspections = overview?.inspections || [];

      const statEls = document.querySelectorAll('.stat .v');
      if (statEls[0]) statEls[0].textContent = props.length;
      if (statEls[1]) statEls[1].textContent = props.filter(p => (p.publishedCount || 0) > 0).length;
      if (statEls[3]) statEls[3].textContent = inspections.filter(i => i.status === 'Requested').length;

      const rowsContainer = document.querySelector('.card ul.rows, .table-wrap tbody');
      if (rowsContainer && path.includes('properties.html')) {
        rowsContainer.innerHTML = props.map(p => `
          <li>
            <div class="grow">
              <strong>${p.title}</strong>
              <span class="muted small">${fmt(p.originalRent)}/yr · ${p.city} · ${p.publishedCount || 0} agents listed</span>
            </div>
            ${chip(p.publishedCount > 0 ? 'published' : 'private')}
          </li>
        `).join('');
      }
    });
  }

  /* ══════════════════════════════════════
     ADMIN OVERVIEW
  ══════════════════════════════════════ */
  if (role === 'admin') {
    api('/api/admin/overview').then(data => {
      if (!data) return;
      const { stats, inspections } = data;
      const statEls = document.querySelectorAll('.stat .v');
      if (statEls[0]) statEls[0].textContent = stats.totalProperties || 0;
      if (statEls[1]) statEls[1].textContent = stats.publishedListings || 0;
      if (statEls[2]) statEls[2].textContent = stats.inspections || 0;

      const ul = document.querySelector('.card ul.rows');
      if (ul) {
        ul.innerHTML = (inspections || []).map(i => `
          <li>
            <div class="grow">
              <strong>${i.trackingId} - ${i.tenantName || 'Tenant'}</strong>
              <span class="muted small">${i.tenantPhone} · ${i.preferredTime} · Agent: ${i.agentCode}</span>
            </div>
            ${chip(i.status)}
          </li>
        `).join('') || '<li><span class="muted">No inspections logged.</span></li>';
      }
    });
  }

})();

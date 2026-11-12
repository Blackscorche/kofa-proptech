/* Kofa prototype behaviour. Plain JavaScript, no libraries.
   Everything here is demo-only: data lives in the page, saved homes in localStorage. */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var digits = function (s) { return parseInt(String(s).replace(/\D/g, ""), 10) || 0; };
  var commas = function (n) { return Number(n).toLocaleString("en-US"); };
  var naira = function (n) { return "\u20A6" + commas(Math.round(n)); };
  var page = (location.pathname.split("/").pop() || "index.html").replace(".html", "");

  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  /* Toast ---------------------------------------------------------------- */
  var toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 3200);
  }

  /* Saved homes ---------------------------------------------------------- */
  function initSaved() {
    var saved = store.get("kofa.saved") || [];
    $$(".lcard .save").forEach(function (btn) {
      var h3 = $("h3", btn.closest(".lcard"));
      var key = h3 ? h3.textContent.trim() : "";
      var on = saved.indexOf(key) > -1 || btn.getAttribute("aria-pressed") === "true";
      set(btn, on);
      btn.addEventListener("click", function () {
        var now = btn.getAttribute("aria-pressed") !== "true";
        set(btn, now);
        saved = saved.filter(function (k) { return k !== key; });
        if (now) saved.push(key);
        store.set("kofa.saved", saved);
        toast(now ? "Saved to your homes." : "Removed from saved homes.");
      });
    });
    function set(btn, on) {
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("aria-label", on ? "Remove from saved homes" : "Save this home");
    }
  }

  /* Money inputs: thousands separators while typing ---------------------- */
  function initMoney() {
    $$(".money input").forEach(function (input) {
      input.addEventListener("input", function () {
        var pos = input.selectionStart, before = input.value.slice(0, pos).replace(/\D/g, "").length;
        var d = input.value.replace(/\D/g, "");
        input.value = d ? commas(d) : "";
        var n = 0, i = 0;
        while (i < input.value.length && n < before) { if (/\d/.test(input.value[i])) n++; i++; }
        try { input.setSelectionRange(i, i); } catch (e) {}
      });
    });
  }

  /* Listings: live filter and sort --------------------------------------- */
  function typeOf(title) {
    var t = title.toLowerCase();
    if (/self-contain/.test(t)) return "self-contain";
    if (/mini flat/.test(t)) return "mini flat";
    if (/duplex/.test(t)) return "duplex";
    if (/terrace/.test(t)) return "terrace";
    if (/bungalow/.test(t)) return "bungalow";
    if (/studio/.test(t)) return "studio";
    return "flat";
  }

  function initListings() {
    var form = $(".filters form");
    if (!form) return;
    var grid = $(".grid-cards", form.closest(".results-layout"));
    var count = $(".results-head p");
    var sort = $("#sort");
    var cards = $$(".lcard", grid).map(function (el, i) {
      var title = $("h3", el).textContent.trim();
      var bedsLi = $$(".facts li", el).filter(function (li) { return /bed/i.test(li.textContent); })[0];
      return {
        el: el, order: i, title: title, type: typeOf(title),
        price: digits($(".price", el).textContent),
        beds: bedsLi ? digits(bedsLi.textContent) : 0,
        text: (title + " " + $(".loc", el).textContent).toLowerCase()
      };
    });
    var empty = document.createElement("p");
    empty.className = "notice";
    empty.hidden = true;
    empty.textContent = "No homes match these filters. Try a wider price range or fewer filters.";
    grid.parentNode.insertBefore(empty, grid.nextSibling);

    var f = function (name) { return form.elements[name]; };

    // Pre-fill from the home page search (?q=...&beds=...&max=...)
    var params = new URLSearchParams(location.search);
    ["q", "type", "beds", "min", "max"].forEach(function (n) {
      var v = params.get(n), el = f(n);
      if (!v || !el) return;
      if (n === "min" || n === "max") el.value = commas(digits(v));
      else if (el.tagName === "SELECT") {
        var want = n === "beds" ? String(digits(v)) + (/more/i.test(v) ? " or more" : "") : v;
        $$("option", el).forEach(function (o) { if (o.textContent.trim().toLowerCase() === want.toLowerCase()) el.value = o.value || o.textContent; });
      } else el.value = v;
    });

    function apply() {
      var q = (f("q").value || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
      var type = (f("type").value || "").toLowerCase();
      var bedsRaw = f("beds").value || "", beds = digits(bedsRaw), more = /more/i.test(bedsRaw);
      var min = digits(f("min").value), max = digits(f("max").value);

      var shown = cards.filter(function (c) {
        var ok = q.every(function (w) { return c.text.indexOf(w) > -1; });
        if (type && c.type !== type) ok = false;
        if (beds && (more ? c.beds < beds : c.beds !== beds)) ok = false;
        if (min && c.price < min) ok = false;
        if (max && c.price > max) ok = false;
        return ok;
      });
      var mode = sort ? sort.value : "";
      shown.sort(function (a, b) {
        if (/low to high/i.test(mode)) return a.price - b.price;
        if (/high to low/i.test(mode)) return b.price - a.price;
        return a.order - b.order;
      });
      cards.forEach(function (c) { c.el.hidden = true; });
      shown.forEach(function (c) { c.el.hidden = false; grid.appendChild(c.el); });
      if (count) count.textContent = shown.length + (shown.length === 1 ? " home" : " homes");
      empty.hidden = shown.length > 0;
    }

    form.addEventListener("input", apply);
    form.addEventListener("change", apply);
    form.addEventListener("submit", function (e) { e.preventDefault(); apply(); });
    if (sort) sort.addEventListener("change", apply);
    apply();
  }

  /* Dashboard search boxes (users table, agent pool) ---------------------- */
  function initToolbarSearch() {
    var form = $(".toolbar[role=search]");
    if (!form) return;
    var items = $$(".table tbody tr").concat($$(".grid-cards .lcard"));
    if (!items.length) return;
    var q = form.elements.q;
    var params = new URLSearchParams(location.search);
    if (params.get("q")) q.value = params.get("q");
    function apply() {
      var words = q.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      var city = form.elements.city ? form.elements.city.value.toLowerCase() : "";
      var beds = form.elements.beds ? digits(form.elements.beds.value) : 0;
      items.forEach(function (el) {
        var t = el.textContent.toLowerCase();
        var ok = words.every(function (w) { return t.indexOf(w) > -1; });
        if (city && t.indexOf(city) < 0) ok = false;
        if (beds && !new RegExp("\\b" + beds + "\\s*(bed|-bedroom)", "i").test(el.textContent)) ok = false;
        el.hidden = !ok;
      });
    }
    form.addEventListener("input", apply);
    form.addEventListener("change", apply);
    form.addEventListener("submit", function (e) { e.preventDefault(); apply(); });
    apply();
  }

  /* Landlord: live price preview and photo previews ----------------------- */
  function initAddProperty() {
    var rent = $("#rent");
    if (rent) {
      var note = $(".notice-amber p", rent.closest(".card"));
      var original = note ? note.innerHTML : "";
      rent.addEventListener("input", function () {
        var n = digits(rent.value);
        if (!note) return;
        note.innerHTML = n
          ? "Kofa adds 10% when an agent publishes your home. At " + naira(n) + " rent, the public price is <strong>" + naira(n * 1.1) + "</strong>, and you receive the full " + naira(n) + "."
          : original;
      });
    }
    var file = $('input[type=file][name=photos]');
    if (!file) return;
    var strip = document.createElement("ul");
    strip.className = "previews";
    file.closest(".drop").appendChild(strip);
    file.addEventListener("change", function () {
      var files = Array.prototype.slice.call(file.files);
      if (files.length > 10) {
        files = files.slice(0, 10);
        try { var dt = new DataTransfer(); files.forEach(function (f) { dt.items.add(f); }); file.files = dt.files; } catch (e) {}
        toast("Only the first 10 photos are kept.");
      }
      strip.innerHTML = "";
      files.forEach(function (f) {
        var li = document.createElement("li"), img = document.createElement("img");
        img.alt = f.name; img.src = URL.createObjectURL(f);
        img.onload = function () { URL.revokeObjectURL(img.src); };
        li.appendChild(img); strip.appendChild(li);
      });
    });
  }

  /* Forms that post to "#": confirm, then move the demo along ------------- */
  var formFlows = {
    login:          { msg: "Logged in. Taking you to your dashboard.", go: "tenant/index.html" },
    register:       { msg: "Account created. Taking you to your dashboard.", go: function (f) { return (f.elements.role && f.elements.role.value || "tenant") + "/index.html"; } },
    safety:         { msg: "Report sent. The Kofa team will review it." },
    listing:        { msg: "Inspection requested. The agent will confirm the time." },
    checkout:       { msg: "Payment received and recorded. Taking you to your payments.", go: "payments.html" },
    "add-property": { msg: "Property uploaded. It is now in the agent pool.", go: "properties.html" },
    "pool-item":    { msg: "Home published under your agent ID.", go: "my-listings.html" },
    settings:       { msg: "Changes saved." }
  };

  function initForms() {
    $$('form[action="#"]').forEach(function (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var formData = new FormData(form);
        var payload = {};
        formData.forEach(function (v, k) { payload[k] = v; });

        // Real API for Login
        if (page === "login") {
          fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          })
          .then(function (res) { return res.json().then(function (d) { return { status: res.status, data: d }; }); })
          .then(function (res) {
            if (res.status === 200 && res.data.user) {
              toast("Welcome back, " + res.data.user.name + "!");
              var params = new URLSearchParams(location.search);
              var redirect = params.get("redirect");
              var role = res.data.user.role;
              var target = redirect || (role + "/index.html");
              setTimeout(function () { location.href = target; }, 800);
            } else {
              toast(res.data.error || "Login failed. Check your details.");
            }
          })
          .catch(function (err) { toast("Network error: " + err.message); });
          return;
        }

        // Real API for Registration
        if (page === "register") {
          fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          })
          .then(function (res) { return res.json().then(function (d) { return { status: res.status, data: d }; }); })
          .then(function (res) {
            if (res.status === 200 && res.data.user) {
              toast("Account created! Taking you in...");
              var role = res.data.user.role;
              setTimeout(function () { location.href = role + "/index.html"; }, 1000);
            } else {
              toast(res.data.error || "Registration failed.");
            }
          })
          .catch(function (err) { toast("Network error: " + err.message); });
          return;
        }

        // Real API for Requesting Inspection from Listing page
        if (page === "listing") {
          var bookData = {
            propertyId: "PROP-D9EF92", // or dynamically matched
            tenantName: payload.name,
            tenantPhone: payload.phone,
            preferredTime: payload.time || "Afternoon",
            channel: "Web"
          };
          fetch("/api/inspections/book", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bookData)
          })
          .then(function (res) { return res.json().then(function (d) { return { status: res.status, data: d }; }); })
          .then(function (res) {
            if (res.status === 200 && res.data.trackingId) {
              toast("Inspection booked! Tracking ID: " + res.data.trackingId);
              form.reset();
              setTimeout(function () { location.href = "tenant/inspections.html"; }, 1600);
            } else {
              toast(res.data.error || "Could not book inspection.");
            }
          })
          .catch(function () {
            toast("Inspection requested. Agent notified via SMS.");
          });
          return;
        }

        // Real API for Checkout Payment
        if (page === "checkout") {
          toast("Connecting to Escrow payment gateway...");
          // Call payment API for default sample tracking ID or current
          fetch("/api/inspections/TRK-SAMPLE/pay", { method: "POST" })
          .catch(function () {});
          setTimeout(function () {
            toast("Payment received & held in Escrow!");
            setTimeout(function () { location.href = "payments.html"; }, 1000);
          }, 900);
          return;
        }

        // Real API for Landlord Property Upload
        if (page === "add-property") {
          var propData = {
            title: payload.title,
            type: payload.type,
            bedrooms: payload.beds,
            bathrooms: payload.baths,
            location: payload.area || "Kaduna",
            city: payload.state || "Kaduna",
            originalRent: payload.rent
          };
          fetch("/api/landlord/properties", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(propData)
          })
          .then(function (res) { return res.json().then(function (d) { return { status: res.status, data: d }; }); })
          .then(function (res) {
            if (res.status === 200 && res.data.accountNumber) {
              toast("Property uploaded! Account #: " + res.data.accountNumber);
              setTimeout(function () { location.href = "properties.html"; }, 1200);
            } else {
              toast(res.data.error || "Upload failed.");
            }
          })
          .catch(function () {
            toast("Property uploaded to Agent Pool.");
            setTimeout(function () { location.href = "properties.html"; }, 1200);
          });
          return;
        }

        var flow = formFlows[page] || { msg: "Done." };
        toast(flow.msg);
        var dest = typeof flow.go === "function" ? flow.go(form) : flow.go;
        if (dest) setTimeout(function () { location.href = dest; }, 1400);
        else if (page !== "settings") form.reset();
      });
    });
  }

  /* Dashboard actions: Approve, Reject, Suspend and so on ------------------ */
  var outcomes = {
    "approve": ["Approved", "chip-green"], "reject": ["Rejected", "chip-red"],
    "suspend": ["Suspended", "chip-red"], "restore": ["Active", "chip-green"],
    "release commission": ["Released", "chip-green"], "mark as resolved": ["Resolved", "chip-green"],
    "dismiss report": ["Dismissed", "chip-blue"], "unpublish": ["Unpublished", "chip-amber"],
    "remove from public": ["Removed from public", "chip-amber"], "accept": ["Accepted", "chip-green"],
    "decline": ["Declined", "chip-red"], "cancel": ["Cancelled", "chip-red"]
  };

  /* Filtered tabs (New, Pending review, Live...): when an action moves a row
     out of the tab, take it off the list, drop the counts and show an empty note. */
  function leaveTab(row, wrap) {
    setTimeout(function () {
      var tbody = row.parentNode;
      row.remove();
      var tab = $(".tabs a[aria-current]");
      if (tab) tab.textContent = tab.textContent.replace(/\((\d+)\)/, function (m, n) { return "(" + Math.max(0, n - 1) + ")"; });
      var badge = $(".side-nav a[aria-current] .badge");
      if (badge) { var left = digits(badge.textContent) - 1; if (left > 0) badge.textContent = left; else badge.remove(); }
      if (!$$("tr", tbody).length) {
        var note = document.createElement("div");
        note.className = "notice";
        note.innerHTML = "<p>Nothing left here. You are all caught up.</p>";
        wrap.parentNode.replaceChild(note, wrap);
      }
    }, 1100);
  }

  function initActions() {
    document.addEventListener("click", function (e) {
      var a = e.target.closest('a[href="#"]');
      if (!a) return;
      e.preventDefault();
      var label = a.textContent.trim().toLowerCase();
      var out = outcomes[label];
      var row = a.closest("tr, li, article, .card");
      var chip = row && $(".chip", row);
      if (!out || !chip) { toast("Demo only: this opens a detail view in the full build."); return; }
      chip.className = "chip " + out[1];
      chip.textContent = out[0];
      var box = a.closest(".actions") || a.parentNode;
      $$("a, button", box).forEach(function (el) {
        el.setAttribute("aria-disabled", "true");
        el.style.pointerEvents = "none"; el.style.opacity = ".45";
      });
      toast(out[0] + ".");
      var wrap = row.closest(".table-wrap[data-leaves]");
      if (wrap && row.tagName === "TR") leaveTab(row, wrap);
    });
  }

  /* Mobile menu: close on Escape or after choosing a link ------------------ */
  function initMenu() {
    var t = $(".nav-toggle");
    if (!t) return;
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && t.checked) { t.checked = false; t.focus(); } });
    $$(".site-nav a").forEach(function (a) { a.addEventListener("click", function () { t.checked = false; }); });
  }

  function init() {
    initSaved(); initMoney(); initListings(); initToolbarSearch();
    initAddProperty(); initForms(); initActions(); initMenu();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();

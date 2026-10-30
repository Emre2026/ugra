// Uğra firm panel: calendar, services, working hours, team and the booking link.
// Talks to the same API as the apps; the sign-in token is kept in this browser.
(function () {
  "use strict";

  // ---------- Small helpers ----------

  const $ = (id) => document.getElementById(id);
  const HOUR = 80;                  // calendar pixels per hour
  const PX = HOUR / 60;
  const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
  const STATUS = { Booked: "Bekliyor", Arrived: "Geldi", Completed: "Bitti", NoShow: "Gelmedi", Cancelled: "İptal" };
  const SOURCE = { Staff: "Dükkân", WalkIn: "Kapıdan", App: "Uygulama", Web: "Online" };
  const ROLE = { Owner: "İşletme sahibi", Manager: "Yönetici", Staff: "Çalışan" };
  const STATUS_ICON = { Booked: "bi-clock", Arrived: "bi-person-check", Completed: "bi-check-circle-fill", NoShow: "bi-x-circle" };
  // "Emre Usta" → "EU", "Ali" → "AL"
  const initials = (name) => {
    const parts = String(name || "?").trim().split(/\s+/);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toLocaleUpperCase("tr-TR");
  };

  const store = {
    get(key) { try { return localStorage.getItem("ugra." + key); } catch { return null; } },
    set(key, value) { try { value == null ? localStorage.removeItem("ugra." + key) : localStorage.setItem("ugra." + key, value); } catch { } }
  };

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const hm = (minutes) => pad(Math.floor(minutes / 60)) + ":" + pad(minutes % 60);
  // "09:30:00" or "2026-10-28T09:30:00" -> minutes after midnight
  const mins = (text) => { const t = String(text).split("T").pop(); return +t.slice(0, 2) * 60 + +t.slice(3, 5); };
  const dateOf = (text) => String(text).slice(0, 10);
  const at = (date, minutes) => `${date}T${hm(minutes)}:00`;
  const money = (n) => Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " ₺";
  const toDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => isoDate(new Date());
  const addDays = (iso, n) => { const d = toDate(iso); d.setDate(d.getDate() + n); return isoDate(d); };
  const weekday = (iso) => ((toDate(iso).getDay() + 6) % 7) + 1;   // 1 = Monday ... 7 = Sunday
  const longDate = (iso) => toDate(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" });
  const shortDate = (iso) => toDate(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", weekday: "short" });
  const phoneDigits = (p) => { let d = String(p || "").replace(/\D/g, ""); if (d.startsWith("0")) d = "9" + d; else if (d.length === 10) d = "90" + d; return d; };

  function toast(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // ---------- State ----------

  const state = {
    token: store.get("token"),
    me: null,
    branches: [],
    branch: null,
    tab: store.get("tab") || "today",
    day: today(),
    plan: null,
    services: [],
    team: []
  };

  const isManager = () => state.me && (state.me.role === "Owner" || state.me.role === "Manager");
  const isOwner = () => state.me && state.me.role === "Owner";
  const base = () => `/api/branches/${state.branch.id}`;

  // ---------- API ----------

  // Where the API is: empty when the panel comes from the server itself, the server's address on GitHub Pages
  const API = ((window.UGRA && window.UGRA.api) || "").replace(/\/$/, "");

  async function api(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: Object.assign({ "Content-Type": "application/json" }, state.token ? { Authorization: "Bearer " + state.token } : {}),
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (res.status === 401 && state.token) { signOut("Oturumun kapandı, yeniden giriş yap."); throw new Error("Oturum kapandı."); }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!res.ok) {
      const message = typeof data === "string" && data ? data
        : data && (data.detail || data.title) ? data.detail || data.title
        : res.status === 403 ? "Bunu yapmaya yetkin yok."
        : res.status === 429 ? "Çok fazla deneme oldu, bir dakika sonra tekrar dene."
        : "Bir şeyler ters gitti (" + res.status + ").";
      throw new Error(message);
    }
    return data;
  }

  // ---------- Screens: sign-in and password ----------

  function show(screen) {
    for (const id of ["login", "password", "app"]) $(id).hidden = id !== screen;
  }

  function signOut(message) {
    state.token = null;
    state.me = null;
    store.set("token", null);
    stopRefresh();
    if ($("dlg").open) $("dlg").close();
    show("login");
    $("login-error").textContent = message || "";
    $("l-pass").value = "";
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = e.submitter;
    button.disabled = true;
    $("login-error").textContent = "";
    try {
      const session = await api("POST", "/api/login", {
        businessCode: $("l-code").value.trim(), userName: $("l-user").value.trim(), password: $("l-pass").value
      });
      store.set("code", $("l-code").value.trim());
      store.set("user", $("l-user").value.trim());
      await signedIn(session);
    } catch (err) {
      $("login-error").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });

  $("password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("password-error").textContent = "";
    if ($("p-new").value !== $("p-new2").value) { $("password-error").textContent = "Yeni şifreler aynı değil."; return; }
    try {
      const session = await api("POST", "/api/me/password", { currentPassword: $("p-old").value, newPassword: $("p-new").value });
      $("password-form").reset();
      await signedIn(session);
      toast("Şifren değişti.");
    } catch (err) {
      $("password-error").textContent = err.message;
    }
  });

  document.querySelectorAll("[data-logout]").forEach((b) => b.addEventListener("click", () => signOut()));

  async function signedIn(session) {
    state.token = session.token;
    store.set("token", session.token);
    state.me = session.me;
    await enter();
  }

  async function enter() {
    if (state.me.mustChangePassword) { show("password"); return; }

    $("biz-name").textContent = state.me.businessName;
    $("me-name").textContent = state.me.fullName + " · " + ROLE[state.me.role];
    document.querySelectorAll("[data-manager]").forEach((el) => (el.hidden = !isManager()));

    const all = await api("GET", "/api/branches");
    state.branches = all.filter((b) => b.isActive && (state.me.branchId == null || b.id === state.me.branchId));
    if (!state.branches.length) { show("app"); $("cal").innerHTML = ""; toast("Açık bir şuben yok."); return; }

    const saved = Number(store.get("branch"));
    state.branch = state.branches.find((b) => b.id === saved)
      || state.branches.find((b) => b.kind === "Barber" || b.kind === "HairSalon")
      || state.branches[0];

    const select = $("branch");
    select.innerHTML = state.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
    select.value = state.branch.id;
    select.hidden = state.branches.length < 2;

    show("app");
    if ((state.tab === "team" || state.tab === "reports") && !isManager()) state.tab = "today";
    await openTab(state.tab);
  }

  $("branch").addEventListener("change", async () => {
    state.branch = state.branches.find((b) => b.id === Number($("branch").value));
    store.set("branch", state.branch.id);
    state.plan = null;
    await openTab(state.tab);
  });

  // ---------- Tabs ----------

  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => openTab(b.dataset.tab)));

  async function openTab(tab) {
    state.tab = tab;
    store.set("tab", tab);
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    document.querySelectorAll("main > section").forEach((s) => (s.hidden = s.id !== "tab-" + tab));

    try {
      if (tab === "calendar" || tab === "today") startRefresh();
      else stopRefresh();
      if (tab === "today") await loadToday();
      if (tab === "calendar") await loadDay();
      if (tab === "customers") await loadCustomers();
      if (tab === "reports") await loadReport();
      if (tab === "services") await loadServices(true);
      if (tab === "hours") await loadHours();
      if (tab === "team") await loadTeam();
      if (tab === "share") showShare();
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- Calendar ----------

  let refreshTimer = null;
  function startRefresh() {
    stopRefresh();
    refreshTimer = setInterval(() => {
      if (!document.hidden && !$("dlg").open && (state.tab === "calendar" || state.tab === "today")) reloadCurrent().catch(() => { });
    }, 30000);
  }
  function stopRefresh() { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = null; }

  $("day-prev").addEventListener("click", () => goDay(addDays(state.day, -1)));
  $("day-next").addEventListener("click", () => goDay(addDays(state.day, 1)));
  $("day-today").addEventListener("click", () => goDay(today()));
  $("day-pick").addEventListener("change", () => { if ($("day-pick").value) goDay($("day-pick").value); });
  $("new-appt").addEventListener("click", () => newAppointment({}));
  $("walk-in").addEventListener("click", () => walkIn());

  function goDay(day) { state.day = day; loadDay().catch((err) => toast(err.message)); }

  async function loadServices(force) {
    if (!force && state.services.length && state.services.branch === state.branch.id) return state.services;
    const list = await api("GET", base() + "/services");
    list.branch = state.branch.id;
    state.services = list;
    if (state.tab === "services") drawServices();
    return list;
  }

  async function loadDay() {
    const [plan] = await Promise.all([api("GET", `${base()}/day?date=${state.day}`), loadServices()]);
    state.plan = plan;
    drawDay();
  }

  // The hours a person works on the shown day, minus breaks and time off
  function closedParts(schedule, plan) {
    const day = schedule.days.find((d) => d.day === weekday(plan.date));
    if (!day) return { open: null, parts: [] };

    const parts = [];
    const open = [mins(day.start), mins(day.end)];
    if (day.breakStart) parts.push({ from: mins(day.breakStart), to: mins(day.breakEnd), label: "Mola" });
    for (const off of plan.timeOff.filter((t) => t.staffId === schedule.staffId)) {
      parts.push(off.start
        ? { from: mins(off.start), to: mins(off.end), label: off.reason || "İzin" }
        : { from: 0, to: 24 * 60, label: off.reason || "İzinli", whole: true });
    }
    return { open, parts };
  }

  function drawDay() {
    const plan = state.plan;
    const staff = plan.schedules;
    const live = plan.appointments.filter((a) => a.status !== "Cancelled");

    $("day-pick").value = state.day;
    $("day-title").textContent = longDate(state.day) + (state.day === today() ? " · bugün" : "");

    // Summary
    const count = (s) => live.filter((a) => a.status === s).length;
    const done = live.filter((a) => a.status === "Completed").reduce((t, a) => t + a.price, 0);
    const expected = live.filter((a) => a.status !== "NoShow").reduce((t, a) => t + a.price, 0);
    $("day-stats").innerHTML = [
      [live.length, "randevu", ""], [count("Booked"), "bekliyor", "Booked"], [count("Arrived"), "içeride", "Arrived"],
      [count("Completed"), "bitti", "Completed"], [count("NoShow"), "gelmedi", "NoShow"],
      [money(done), "kazanılan", "money"], [money(expected), "günün toplamı", "money"]
    ].map(([v, t, k]) => `<div class="stat ${k}"><b>${esc(v)}</b><span>${k && k !== "money" ? '<i class="dot"></i>' : ""}${t}</span></div>`).join("");

    const cancelled = plan.appointments.filter((a) => a.status === "Cancelled");
    $("cancelled").innerHTML = cancelled.length
      ? "İptal edilenler: " + cancelled.map((a) => `${hm(mins(a.startsAt))} ${esc(a.customerName)} (${esc(a.serviceName)})`).join(" · ")
      : "";

    const cal = $("cal");
    if (!staff.length) {
      cal.style.gridTemplateColumns = "1fr";
      cal.innerHTML = `<div class="empty">Bu şubede randevu alan kimse yok.${isManager() ? " Ekip sekmesinden birine “Randevu alır” işaretini koy." : ""}</div>`;
      return;
    }

    // Shown hours: from the earliest opening to the latest closing, and every appointment
    let first = 24 * 60, last = 0;
    const columns = staff.map((s) => ({ s, ...closedParts(s, plan) }));
    for (const c of columns) if (c.open) { first = Math.min(first, c.open[0]); last = Math.max(last, c.open[1]); }
    for (const a of live) { first = Math.min(first, mins(a.startsAt)); last = Math.max(last, mins(a.endsAt)); }
    if (first >= last) { first = 9 * 60; last = 20 * 60; }
    first = Math.floor(first / 60) * 60;
    last = Math.min(24 * 60, Math.ceil(last / 60) * 60);
    state.calFirst = first;
    const height = (last - first) * PX;
    const y = (m) => (Math.max(first, Math.min(last, m)) - first) * PX;

    cal.style.gridTemplateColumns = `52px repeat(${staff.length}, minmax(150px, 1fr))`;
    cal.style.setProperty("--hour", HOUR + "px");

    let html = `<div class="cal-head cal-corner"></div>`;
    columns.forEach((c, i) => {
      const n = live.filter((a) => a.staffId === c.s.staffId).length;
      const hours = c.open ? `${hm(c.open[0])}–${hm(c.open[1])}` : "Kapalı";
      html += `<div class="cal-head"><span class="avatar c${i % 5}">${esc(initials(c.s.staffName))}</span>`
        + `<span class="who">${esc(c.s.staffName)}<small>${hours} · ${n} randevu</small></span></div>`;
    });

    html += `<div class="times" style="height:${height}px">`;
    for (let m = first + 60; m < last; m += 60) html += `<div style="top:${y(m)}px">${hm(m)}</div>`;
    html += `</div>`;

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    for (const c of columns) {
      html += `<div class="col" data-staff="${c.s.staffId}" style="height:${height}px">`;
      const shades = [];
      if (!c.open) shades.push({ from: first, to: last, label: "Çalışmıyor" });
      else {
        if (c.open[0] > first) shades.push({ from: first, to: c.open[0] });
        if (c.open[1] < last) shades.push({ from: c.open[1], to: last });
        shades.push(...c.parts);
      }
      for (const sh of shades) {
        const top = y(sh.from), h = y(sh.to) - top;
        if (h > 0) html += `<div class="shade" style="top:${top}px;height:${h}px">${sh.label ? `<span><i class="bi bi-slash-circle"></i>${esc(sh.label)}</span>` : ""}</div>`;
      }
      for (const a of live.filter((x) => x.staffId === c.s.staffId)) {
        const top = y(mins(a.startsAt)), h = Math.max(22, y(mins(a.endsAt)) - top - 2);
        // Short ones (a 15-minute beard) get one line: time and name
        const short = h < 34;
        html += `<div class="appt ${a.status}${short ? " short" : ""}" data-id="${a.id}" style="top:${top + 1}px;height:${h}px" title="${esc(a.customerName)} · ${esc(a.serviceName)}">`
          + (a.source === "Staff" || short ? "" : `<span class="src">${SOURCE[a.source]}</span>`)
          + (short
            ? `<b><span class="t">${hm(mins(a.startsAt))}</span> ${esc(a.customerName)} <span>· ${esc(a.serviceName)}</span></b>`
            : `<b>${esc(a.customerName)}</b><span><span class="t">${hm(mins(a.startsAt))}</span> · ${esc(a.serviceName)}</span>`)
          + (h >= 40 ? `<i class="bi ${STATUS_ICON[a.status] || ""} st"></i>` : "") + `</div>`;
      }
      if (state.day === today() && nowMin > first && nowMin < last) html += `<div class="now" style="top:${y(nowMin)}px"></div>`;
      if (c === columns[columns.length - 1] && state.day === today() && nowMin > first && nowMin < last)
        html += `<span class="now-label" style="top:${y(nowMin)}px">${hm(nowMin)}</span>`;
      html += `</div>`;
    }
    cal.innerHTML = html;

    // Scroll to now (or the opening) the first time a day is shown
    const wrap = cal.parentElement;
    if (wrap.dataset.day !== state.day) {
      wrap.dataset.day = state.day;
      const target = state.day === today() ? y(nowMin) - HOUR : 0;
      wrap.scrollTop = Math.max(0, target);
    }
  }

  $("cal").addEventListener("click", (e) => {
    const appt = e.target.closest(".appt");
    if (appt) { showAppointment(state.plan.appointments.find((a) => a.id === Number(appt.dataset.id))); return; }

    const col = e.target.closest(".col");
    if (!col) return;
    const rect = col.getBoundingClientRect();
    const minute = state.calFirst + Math.floor((e.clientY - rect.top) / PX / 15) * 15;
    newAppointment({ staffId: Number(col.dataset.staff), minute });
  });

  // ---------- Dialogs ----------

  const dlg = $("dlg"), body = $("dlg-body");
  function openDialog(html, setup) {
    body.innerHTML = html;
    body.onsubmit = null;
    if (!dlg.open) dlg.showModal();
    body.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dlg.close()));
    if (setup) setup(body);
  }
  dlg.addEventListener("close", () => { body.innerHTML = ""; });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  const field = (name) => body.querySelector(`[name="${name}"]`);
  const setError = (text) => { const el = body.querySelector(".error"); if (el) el.textContent = text || ""; };

  function serviceOptions(selected) {
    return state.services.filter((s) => s.isActive)
      .map((s) => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${esc(s.name)} · ${s.durationMinutes} dk · ${money(s.price)}</option>`).join("");
  }
  function staffOptions(selected, anyone) {
    const list = (state.plan && state.plan.schedules) || [];
    return (anyone ? `<option value="">Fark etmez</option>` : "")
      + list.map((s) => `<option value="${s.staffId}" ${s.staffId === selected ? "selected" : ""}>${esc(s.staffName)}</option>`).join("");
  }

  // Free start times for a service; the slot buttons fill the given box
  async function fillSlots(box, { serviceId, date, staffId, wanted }) {
    box.innerHTML = `<span class="muted">Boş saatler yükleniyor…</span>`;
    box.dataset.value = "";
    try {
      const query = `serviceId=${serviceId}&date=${date}` + (staffId ? `&staffId=${staffId}` : "");
      const slots = await api("GET", `${base()}/availability?${query}`);
      if (!slots.length) { box.innerHTML = `<span class="muted">Bu gün için boş saat yok.</span>`; return; }

      box.innerHTML = slots.map((s) => `<button type="button" class="slot" data-at="${s.startsAt}">${hm(mins(s.startsAt))}</button>`).join("");
      const pick = (btn) => {
        box.querySelectorAll(".slot").forEach((b) => b.classList.toggle("on", b === btn));
        box.dataset.value = btn ? btn.dataset.at : "";
      };
      box.querySelectorAll(".slot").forEach((b) => b.addEventListener("click", () => pick(b)));

      if (wanted != null) {
        const exact = [...box.querySelectorAll(".slot")].find((b) => mins(b.dataset.at) === wanted);
        if (exact) { pick(exact); exact.scrollIntoView({ block: "nearest" }); }
        else {
          const next = [...box.querySelectorAll(".slot")].find((b) => mins(b.dataset.at) > wanted);
          if (next) next.scrollIntoView({ block: "nearest" });
          setError(`${hm(wanted)} dolu ya da çalışma saati dışında. Boş saatlerden birini seç.`);
        }
      }
    } catch (err) {
      box.innerHTML = `<span class="error">${esc(err.message)}</span>`;
    }
  }

  function newAppointment({ staffId, minute, name, phone, date }) {
    if (!state.services.some((s) => s.isActive)) { toast("Önce Hizmetler sekmesinden bir hizmet aç."); return; }
    const first = state.services.find((s) => s.isActive).id;

    openDialog(`
      <h3>Yeni randevu</h3>
      <p class="sub">Telefonla ya da dükkânda alınan randevu.</p>
      <label>Hizmet</label><select name="service">${serviceOptions(first)}</select>
      <div class="row">
        <div><label>Kim yapacak</label><select name="staff">${staffOptions(staffId, true)}</select></div>
        <div><label>Gün</label><input type="date" name="date" value="${date || state.day}" min="${today()}"></div>
      </div>
      <label>Saat</label><div class="slots" id="slots"></div>
      <label>Müşteri adı</label><input name="name" required maxlength="80" autocomplete="off" value="${esc(name || "")}">
      <div class="row">
        <div><label>Telefon</label><input name="phone" type="tel" placeholder="05xx xxx xx xx" autocomplete="off" value="${esc(phone || "")}"></div>
        <div><label>Not</label><input name="note" maxlength="200" autocomplete="off"></div>
      </div>
      <div class="error"></div>
      <div class="actions"><button type="button" class="btn" data-close>Vazgeç</button><button class="btn main">Kaydet</button></div>`, () => {
      const box = $("slots");
      let wanted = minute;
      const reload = () => { setError(""); fillSlots(box, { serviceId: field("service").value, date: field("date").value, staffId: field("staff").value, wanted }); wanted = null; };
      ["service", "staff", "date"].forEach((n) => field(n).addEventListener("change", reload));
      reload();
      setTimeout(() => field("name").focus(), 50);

      body.onsubmit = async (e) => {
        e.preventDefault();
        if (!box.dataset.value) { setError("Bir saat seç."); return; }
        try {
          const saved = await api("POST", base() + "/appointments", {
            serviceId: Number(field("service").value),
            staffId: field("staff").value ? Number(field("staff").value) : null,
            startsAt: box.dataset.value,
            customerName: field("name").value.trim(),
            customerPhone: field("phone").value.trim() || null,
            note: field("note").value.trim() || null
          });
          dlg.close();
          toast(`Randevu alındı: ${shortDate(dateOf(saved.startsAt))} ${hm(mins(saved.startsAt))} · ${saved.staffName}`);
          state.day = dateOf(saved.startsAt);
          await reloadCurrent();
        } catch (err) { setError(err.message); }
      };
    });
  }

  function walkIn() {
    if (!state.services.some((s) => s.isActive)) { toast("Önce Hizmetler sekmesinden bir hizmet aç."); return; }
    openDialog(`
      <h3>Sıraya ekle</h3>
      <p class="sub">Randevusuz gelen müşteri bugünün ilk boş saatine yazılır.</p>
      <label>Hizmet</label><select name="service">${serviceOptions(state.services.find((s) => s.isActive).id)}</select>
      <label>Kim yapacak</label><select name="staff">${staffOptions(null, true)}</select>
      <div class="row">
        <div><label>Müşteri adı</label><input name="name" placeholder="Kapıdan müşteri" maxlength="80" autocomplete="off"></div>
        <div><label>Telefon</label><input name="phone" type="tel" autocomplete="off"></div>
      </div>
      <div class="error"></div>
      <div class="actions"><button type="button" class="btn" data-close>Vazgeç</button><button class="btn main">Sıraya ekle</button></div>`, () => {
      body.onsubmit = async (e) => {
        e.preventDefault();
        try {
          const saved = await api("POST", base() + "/walk-in", {
            serviceId: Number(field("service").value),
            staffId: field("staff").value ? Number(field("staff").value) : null,
            customerName: field("name").value.trim(),
            customerPhone: field("phone").value.trim() || null
          });
          dlg.close();
          toast(`Sıraya eklendi: ${hm(mins(saved.startsAt))} · ${saved.staffName}`);
          state.day = today();
          await reloadCurrent();
        } catch (err) { setError(err.message); }
      };
    });
  }

  function showAppointment(a) {
    if (!a) return;
    const phone = a.customerPhone
      ? `<a href="tel:${esc(a.customerPhone)}">${esc(a.customerPhone)}</a> · <a href="${reminderLink(a)}" target="_blank" rel="noopener" data-remind="${a.id}">WhatsApp ile hatırlat</a>`
      : "—";

    const buttons = {
      Booked: [["Arrived", "Geldi", "main"], ["Completed", "Bitti", ""], ["NoShow", "Gelmedi", ""], ["Cancelled", "İptal et", "danger"]],
      Arrived: [["Completed", "Bitti", "main"], ["Booked", "Geri al", ""]],
      Completed: [["Booked", "Geri al", ""]],
      NoShow: [["Booked", "Geri al", ""]],
      Cancelled: []
    }[a.status];

    openDialog(`
      <h3>${esc(a.customerName)}</h3>
      <p class="sub">${shortDate(dateOf(a.startsAt))} · ${hm(mins(a.startsAt))}–${hm(mins(a.endsAt))}</p>
      <dl class="facts">
        <dt>Hizmet</dt><dd>${esc(a.serviceName)} · ${money(a.price)}</dd>
        <dt>Kim</dt><dd>${esc(a.staffName)}</dd>
        <dt>Telefon</dt><dd>${phone}</dd>
        ${a.note ? `<dt>Not</dt><dd>${esc(a.note)}</dd>` : ""}
        <dt>Nereden</dt><dd>${SOURCE[a.source]}</dd>
        <dt>Durum</dt><dd><span class="tag">${STATUS[a.status]}</span></dd>
      </dl>
      <div class="status-btns">${buttons.map(([s, t, c]) => `<button type="button" class="btn ${c}" data-status="${s}">${t}</button>`).join("")}</div>
      <div class="error"></div>
      <div class="actions">
        ${a.status === "Booked" ? `<button type="button" class="btn left" id="move">Taşı</button>` : ""}
        <button type="button" class="btn" data-close>Kapat</button>
      </div>`, () => {
      body.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", async () => {
        if (b.dataset.status === "Cancelled" && !b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Eminsen tekrar bas"; return; }
        try {
          await api("PUT", `/api/appointments/${a.id}/status`, { status: b.dataset.status });
          dlg.close();
          await reloadCurrent();
        } catch (err) { setError(err.message); }
      }));
      const move = $("move");
      if (move) move.addEventListener("click", () => moveAppointment(a));
      body.querySelectorAll("[data-remind]").forEach((l) => l.addEventListener("click", () => markReminded(a.id)));
    });
  }

  function moveAppointment(a) {
    openDialog(`
      <h3>Randevuyu taşı</h3>
      <p class="sub">${esc(a.customerName)} · ${esc(a.serviceName)} · şu an ${shortDate(dateOf(a.startsAt))} ${hm(mins(a.startsAt))}</p>
      <div class="row">
        <div><label>Kim yapacak</label><select name="staff">${staffOptions(a.staffId, false)}</select></div>
        <div><label>Gün</label><input type="date" name="date" value="${dateOf(a.startsAt)}" min="${today()}"></div>
      </div>
      <label>Yeni saat</label><div class="slots" id="slots"></div>
      <div class="error"></div>
      <div class="actions"><button type="button" class="btn" data-close>Vazgeç</button><button class="btn main">Taşı</button></div>`, () => {
      const box = $("slots");
      const reload = () => { setError(""); fillSlots(box, { serviceId: a.serviceId, date: field("date").value, staffId: field("staff").value }); };
      ["staff", "date"].forEach((n) => field(n).addEventListener("change", reload));
      reload();

      body.onsubmit = async (e) => {
        e.preventDefault();
        if (!box.dataset.value) { setError("Yeni bir saat seç."); return; }
        try {
          const saved = await api("PUT", `/api/appointments/${a.id}/move`, { startsAt: box.dataset.value, staffId: Number(field("staff").value) });
          dlg.close();
          toast(`Taşındı: ${shortDate(dateOf(saved.startsAt))} ${hm(mins(saved.startsAt))} · ${saved.staffName}`);
          state.day = dateOf(saved.startsAt);
          await reloadCurrent();
        } catch (err) { setError(err.message); }
      };
    });
  }

  // ---------- Services ----------

  function drawServices() {
    const list = state.services;
    $("services").innerHTML = list.length ? list.map((s) => `
      <div class="item ${s.isActive ? "" : "off"}">
        <div class="grow"><b>${esc(s.name)}</b><small>${s.durationMinutes} dk · ${money(s.price)}</small></div>
        ${s.isActive ? "" : `<span class="tag">Kapalı</span>`}
        ${isManager() ? `<button class="btn small" data-edit="${s.id}">Düzenle</button>` : ""}
      </div>`).join("") : `<div class="empty">Henüz hizmet yok.</div>`;
    $("services").querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => editService(list.find((s) => s.id === Number(b.dataset.edit)))));
  }

  $("add-service").addEventListener("click", () => editService(null));

  function editService(s) {
    openDialog(`
      <h3>${s ? "Hizmeti düzenle" : "Yeni hizmet"}</h3>
      <label>Adı</label><input name="name" required maxlength="80" value="${esc(s ? s.name : "")}" placeholder="Saç kesimi">
      <div class="row">
        <div><label>Süre (dakika)</label><input name="duration" type="number" min="5" max="480" step="5" required value="${s ? s.durationMinutes : 30}"></div>
        <div><label>Ücret (₺)</label><input name="price" type="number" min="0" step="0.01" required value="${s ? s.price : ""}"></div>
      </div>
      <label>Sıra</label><input name="order" type="number" min="0" value="${s ? s.sortOrder : state.services.length + 1}">
      <label class="check"><input type="checkbox" name="active" ${!s || s.isActive ? "checked" : ""}> Müşteriler bu hizmeti seçebilsin</label>
      <div class="error"></div>
      <div class="actions"><button type="button" class="btn" data-close>Vazgeç</button><button class="btn main">Kaydet</button></div>`, () => {
      body.onsubmit = async (e) => {
        e.preventDefault();
        const data = {
          name: field("name").value.trim(), durationMinutes: Number(field("duration").value),
          price: Number(field("price").value), isActive: field("active").checked, sortOrder: Number(field("order").value) || 0
        };
        try {
          await api(s ? "PUT" : "POST", base() + "/services" + (s ? "/" + s.id : ""), data);
          dlg.close();
          await loadServices(true);
          drawServices();
          toast("Kaydedildi.");
        } catch (err) { setError(err.message); }
      };
    });
  }

  // ---------- Working hours and time off ----------

  let schedules = [];

  async function loadHours() {
    const [list, offs] = await Promise.all([api("GET", base() + "/schedules"), api("GET", base() + "/time-off")]);
    schedules = isManager() ? list : list.filter((s) => s.staffId === state.me.userId);

    const select = $("hours-staff");
    const before = Number(select.value);
    select.innerHTML = schedules.map((s) => `<option value="${s.staffId}">${esc(s.staffName)}</option>`).join("");
    if (schedules.some((s) => s.staffId === before)) select.value = before;
    select.hidden = schedules.length < 2;
    $("save-hours").hidden = !schedules.length;
    $("add-off").hidden = !schedules.length;

    drawWeek();
    drawOffs(offs, list);
  }

  $("hours-staff").addEventListener("change", drawWeek);

  function drawWeek() {
    const s = schedules.find((x) => x.staffId === Number($("hours-staff").value));
    if (!s) {
      $("week").innerHTML = `<div class="empty">${isManager() ? "Randevu alan kimse yok. Ekip sekmesinden “Randevu alır” işaretini koy." : "Randevu alan biri olarak işaretli değilsin."}</div>`;
      $("hours-note").textContent = "";
      return;
    }
    const t = (v) => (v ? String(v).slice(0, 5) : "");
    $("week").innerHTML = `<div class="day day-head"><span></span><span>Açılış</span><span>Kapanış</span><span>Mola başı</span><span>Mola sonu</span></div>`
      + DAYS.map((name, i) => {
        const d = s.days.find((x) => x.day === i + 1);
        return `<div class="day ${d ? "" : "closed"}" data-day="${i + 1}">
          <label class="check"><input type="checkbox" ${d ? "checked" : ""}> ${name}</label>
          <label class="cell"><span>Açılış</span><input type="time" step="900" data-k="start" value="${t(d ? d.start : "09:00")}"></label>
          <label class="cell"><span>Kapanış</span><input type="time" step="900" data-k="end" value="${t(d ? d.end : "20:00")}"></label>
          <label class="cell"><span>Mola başı</span><input type="time" step="900" data-k="breakStart" value="${t(d && d.breakStart)}"></label>
          <label class="cell"><span>Mola sonu</span><input type="time" step="900" data-k="breakEnd" value="${t(d && d.breakEnd)}"></label>
        </div>`;
      }).join("");
    $("week").querySelectorAll(".day[data-day] input[type=checkbox]").forEach((c) =>
      c.addEventListener("change", () => c.closest(".day").classList.toggle("closed", !c.checked)));
    $("hours-note").textContent = "İşaretsiz gün kapalı sayılır. Mola istemiyorsan mola saatlerini boş bırak.";
  }

  $("save-hours").addEventListener("click", async () => {
    const staffId = Number($("hours-staff").value);
    const days = [];
    for (const row of $("week").querySelectorAll(".day[data-day]")) {
      if (!row.querySelector("input[type=checkbox]").checked) continue;
      const v = (k) => row.querySelector(`[data-k="${k}"]`).value;
      const time = (x) => (x ? x + ":00" : null);
      if (!v("start") || !v("end")) { toast(DAYS[row.dataset.day - 1] + ": açılış ve kapanış saatini yaz."); return; }
      days.push({ day: Number(row.dataset.day), start: time(v("start")), end: time(v("end")), breakStart: time(v("breakStart")), breakEnd: time(v("breakEnd")) });
    }
    try {
      const list = await api("PUT", `${base()}/schedules/${staffId}`, { days });
      schedules = isManager() ? list : list.filter((s) => s.staffId === state.me.userId);
      state.plan = null;
      drawWeek();
      toast("Çalışma saatleri kaydedildi.");
    } catch (err) { toast(err.message); }
  });

  function drawOffs(offs, all) {
    const name = (id) => (all.find((s) => s.staffId === id) || {}).staffName || "";
    const mine = (o) => isManager() || o.staffId === state.me.userId;
    $("offs").innerHTML = offs.length ? offs.map((o) => `
      <div class="item">
        <div class="grow"><b>${esc(name(o.staffId))}</b>
          <small>${shortDate(o.date)} · ${o.start ? `${String(o.start).slice(0, 5)}–${String(o.end).slice(0, 5)}` : "Bütün gün"}${o.reason ? " · " + esc(o.reason) : ""}</small></div>
        ${mine(o) ? `<button class="btn small danger" data-del="${o.id}">Sil</button>` : ""}
      </div>`).join("") : `<div class="empty">Yaklaşan izin yok.</div>`;
    $("offs").querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Emin misin?"; return; }
      try { await api("DELETE", `${base()}/time-off/${b.dataset.del}`); await loadHours(); toast("İzin silindi."); }
      catch (err) { toast(err.message); }
    }));
  }

  $("add-off").addEventListener("click", () => {
    const people = schedules.map((s) => `<option value="${s.staffId}" ${s.staffId === Number($("hours-staff").value) ? "selected" : ""}>${esc(s.staffName)}</option>`).join("");
    openDialog(`
      <h3>İzin ekle</h3>
      <p class="sub">İzinli saatlere randevu verilmez.</p>
      <div class="row">
        <div><label>Kim</label><select name="staff">${people}</select></div>
        <div><label>Gün</label><input type="date" name="date" required value="${today()}" min="${today()}"></div>
      </div>
      <label class="check"><input type="checkbox" name="whole" checked> Bütün gün</label>
      <div class="row" id="off-hours" hidden>
        <div><label>Başlangıç</label><input type="time" name="start" step="900" value="13:00"></div>
        <div><label>Bitiş</label><input type="time" name="end" step="900" value="15:00"></div>
      </div>
      <label>Neden (isteğe bağlı)</label><input name="reason" maxlength="100" placeholder="Doktor, tatil…">
      <div class="error"></div>
      <div class="actions"><button type="button" class="btn" data-close>Vazgeç</button><button class="btn main">Kaydet</button></div>`, () => {
      field("whole").addEventListener("change", () => ($("off-hours").hidden = field("whole").checked));
      body.onsubmit = async (e) => {
        e.preventDefault();
        const whole = field("whole").checked;
        try {
          await api("POST", base() + "/time-off", {
            staffId: Number(field("staff").value), date: field("date").value,
            start: whole ? null : field("start").value + ":00", end: whole ? null : field("end").value + ":00",
            reason: field("reason").value.trim() || null
          });
          dlg.close();
          state.plan = null;
          await loadHours();
          toast("İzin eklendi.");
        } catch (err) { setError(err.message); }
      };
    });
  });

  // ---------- Team ----------

  async function loadTeam() {
    state.team = await api("GET", "/api/staff");
    const branchName = (id) => (id == null ? "Bütün şubeler" : (state.branches.find((b) => b.id === id) || {}).name || "Başka şube");
    $("team").innerHTML = state.team.map((u) => `
      <div class="item ${u.isActive ? "" : "off"}">
        <div class="grow"><b>${esc(u.fullName)}</b><small>${esc(u.userName)} · ${ROLE[u.role]} · ${esc(branchName(u.branchId))}</small></div>
        ${u.takesAppointments ? `<span class="tag">Randevu alır</span>` : ""}
        ${!u.isActive ? `<span class="tag">Kapalı</span>` : u.mustChangePassword ? `<span class="tag">İlk girişi bekliyor</span>` : ""}
        <button class="btn small" data-edit="${u.id}">Düzenle</button>
      </div>`).join("");
    $("team").querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => editStaff(state.team.find((u) => u.id === Number(b.dataset.edit)))));
  }

  $("add-staff").addEventListener("click", () => editStaff(null));

  function editStaff(u) {
    const self = u && u.id === state.me.userId;
    const roles = (u && u.role === "Owner") ? ["Owner"] : isOwner() ? ["Staff", "Manager"] : ["Staff"];
    const branchChoices = (isOwner() ? [`<option value="">Bütün şubeler</option>`] : [])
      .concat(state.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`)).join("");

    openDialog(`
      <h3>${u ? esc(u.fullName) : "Yeni kişi"}</h3>
      <p class="sub">${u ? "Bilgileri değiştir ya da şifresini sıfırla." : "Verdiğin şifreyle ilk girişte kendi şifresini seçer."}</p>
      <label>Ad soyad</label><input name="name" required maxlength="80" value="${esc(u ? u.fullName : "")}">
      <div class="row">
        <div><label>Kullanıcı adı</label><input name="user" required maxlength="40" autocapitalize="none" autocomplete="off" value="${esc(u ? u.userName : "")}"></div>
        <div><label>${u ? "Yeni şifre (boş: aynı kalsın)" : "Geçici şifre"}</label><input name="password" type="text" autocomplete="off" ${u ? "" : "required"}></div>
      </div>
      <div class="row">
        <div><label>Rol</label><select name="role" ${self ? "disabled" : ""}>${roles.map((r) => `<option value="${r}" ${u && u.role === r ? "selected" : ""}>${ROLE[r]}</option>`).join("")}</select></div>
        <div><label>Şube</label><select name="branch">${branchChoices}</select></div>
      </div>
      <label class="check"><input type="checkbox" name="takes" ${u ? (u.takesAppointments ? "checked" : "") : "checked"}> Randevu alır (müşteriler bu kişiyi seçebilir)</label>
      <label class="check"><input type="checkbox" name="active" ${!u || u.isActive ? "checked" : ""} ${self ? "disabled" : ""}> Hesap açık</label>
      <div class="error"></div>
      <div class="actions"><button type="button" class="btn" data-close>Vazgeç</button><button class="btn main">Kaydet</button></div>`, () => {
      field("branch").value = u ? (u.branchId ?? "") : String(state.branch.id);
      if (!field("branch").value && field("branch").options.length) field("branch").selectedIndex = 0;

      body.onsubmit = async (e) => {
        e.preventDefault();
        const data = {
          fullName: field("name").value.trim(), userName: field("user").value.trim(),
          role: field("role").value, branchId: field("branch").value ? Number(field("branch").value) : null,
          isActive: field("active").checked, password: field("password").value || null,
          takesAppointments: field("takes").checked
        };
        try {
          await api(u ? "PUT" : "POST", "/api/staff" + (u ? "/" + u.id : ""), data);
          dlg.close();
          state.plan = null;
          await loadTeam();
          toast(u ? "Kaydedildi." : "Eklendi. Kullanıcı adını ve geçici şifreyi kişiye ilet.");
        } catch (err) { setError(err.message); }
      };
    });
  }

  // ---------- Share ----------

  let qr = null;
  function showShare() {
    // The booking page sits next to the panel: /r/slug on the server, /ugra/r/slug on GitHub Pages
    const url = new URL("../r/", location.href).href + state.branch.slug;
    $("share-link").textContent = url;
    $("open-link").href = url;
    $("wa-link").href = "https://wa.me/?text=" + encodeURIComponent(`${state.branch.name} için online randevu al: ${url}`);

    qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    $("qr").innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true, alt: "Randevu sayfasının QR kodu" });
  }

  $("copy-link").addEventListener("click", async () => {
    const text = $("share-link").textContent;
    try { await navigator.clipboard.writeText(text); }
    catch {
      const range = document.createRange();
      range.selectNodeContents($("share-link"));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      try { document.execCommand("copy"); } catch { }
    }
    toast("Bağlantı kopyalandı.");
  });

  // A large PNG for printing
  $("qr-download").addEventListener("click", () => {
    if (!qr) return;
    const n = qr.getModuleCount(), cell = 16, margin = cell * 4;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = n * cell + margin * 2;
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = "#000";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(margin + c * cell, margin + r * cell, cell, cell);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `randevu-qr-${state.branch.slug}.png`;
    a.click();
  });

  // ---------- Start ----------

  // ---------- Reload whatever is open ----------

  async function reloadCurrent() {
    if (state.tab === "today") await loadToday();
    else if (state.tab === "customers") await loadCustomers();
    else await loadDay();
  }

  // ---------- Reminders (WhatsApp, from the shop's own phone; free and needs no set-up) ----------

  const reminded = new Set(JSON.parse(store.get("reminded") || "[]"));
  function markReminded(id) {
    reminded.add(id);
    store.set("reminded", JSON.stringify([...reminded].slice(-300)));
    if (state.tab === "today") drawToday();
  }

  const firstName = (name) => String(name || "").trim().split(/\s+/)[0];

  function reminderText(a) {
    const day = dateOf(a.startsAt);
    const when = day === today() ? "bugün" : day === addDays(today(), 1) ? "yarın" : shortDate(day);
    return `Merhaba ${firstName(a.customerName)}, ${when} saat ${hm(mins(a.startsAt))}'de ${state.branch.name}'de ${a.serviceName} randevun var. `
      + `Görüşmek üzere! Gelemeyeceksen lütfen haber ver.`;
  }
  const reminderLink = (a) => `https://wa.me/${phoneDigits(a.customerPhone)}?text=${encodeURIComponent(reminderText(a))}`;

  // ---------- Bugün: the shop's day at a glance ----------

  const today$ = { plan: null, tomorrow: null, week: null, free: null };

  async function loadToday() {
    state.day = today();
    await loadServices(false);
    const [plan, tomorrow, week] = await Promise.all([
      api("GET", `${base()}/day?date=${today()}`),
      api("GET", `${base()}/day?date=${addDays(today(), 1)}`),
      isManager() ? api("GET", `${base()}/report?from=${addDays(today(), -6)}&to=${today()}`).catch(() => null) : Promise.resolve(null)
    ]);
    state.plan = plan;
    Object.assign(today$, { plan, tomorrow, week });

    // Free times for the quickest service, for someone walking in
    const quick = state.services.filter((s) => s.isActive).sort((a, b) => a.durationMinutes - b.durationMinutes)[0];
    today$.free = null;
    if (quick) {
      try {
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        const slots = await api("GET", `${base()}/availability?serviceId=${quick.id}&date=${today()}`);
        today$.free = { service: quick, slots: slots.filter((s) => mins(s.startsAt) > nowMin).slice(0, 10) };
      } catch { today$.free = null; }
    }
    drawToday();
  }

  function apptRow(a, { remind } = {}) {
    const done = reminded.has(a.id);
    const wa = remind && a.customerPhone
      ? (done
        ? `<span class="tag ok"><i class="bi bi-check2"></i> Hatırlatıldı</span>`
        : `<a class="btn small wa" href="${reminderLink(a)}" target="_blank" rel="noopener" data-remind="${a.id}"><i class="bi bi-whatsapp"></i> Hatırlat</a>`)
      : "";
    return `<div class="t-row ${a.status}" data-id="${a.id}">
        <span class="t-time">${hm(mins(a.startsAt))}</span>
        <span class="t-who"><b>${esc(a.customerName)}</b><small>${esc(a.serviceName)} · ${esc(a.staffName)}</small></span>
        <span class="t-status st-${a.status}">${STATUS[a.status]}</span>
        ${wa}
      </div>`;
  }

  function drawToday() {
    const plan = today$.plan;
    if (!plan) return;
    const hour = new Date().getHours();
    const greet = hour < 6 ? "İyi geceler" : hour < 12 ? "Günaydın" : hour < 18 ? "İyi günler" : "İyi akşamlar";
    $("today-hello").textContent = `${greet}, ${firstName(state.me.fullName)}`;
    $("today-date").textContent = longDate(today()) + " · " + state.branch.name;

    const live = plan.appointments.filter((a) => a.status !== "Cancelled");
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const waiting = live.filter((a) => a.status === "Booked");
    const inside = live.filter((a) => a.status === "Arrived");
    const next = waiting.filter((a) => mins(a.endsAt) > nowMin).sort((a, b) => mins(a.startsAt) - mins(b.startsAt))[0];
    const earned = live.filter((a) => a.status === "Completed").reduce((t, a) => t + a.price, 0);
    const expected = live.filter((a) => a.status !== "NoShow").reduce((t, a) => t + a.price, 0);

    // The next customer, big
    if (next) {
      const inMin = mins(next.startsAt) - nowMin;
      const when = inMin > 0 ? (inMin < 60 ? `${inMin} dk sonra` : `${Math.floor(inMin / 60)} sa ${inMin % 60} dk sonra`) : "şimdi";
      $("today-next").innerHTML = `
        <div class="next-card">
          <div class="next-label">Sıradaki · ${when}</div>
          <div class="next-main">
            <div class="next-time">${hm(mins(next.startsAt))}</div>
            <div class="next-who"><b>${esc(next.customerName)}</b><span>${esc(next.serviceName)} · ${esc(next.staffName)} · ${money(next.price)}</span></div>
          </div>
          <div class="next-actions">
            <button class="btn main" data-next-status="Arrived"><i class="bi bi-person-check"></i>Geldi</button>
            ${next.customerPhone ? `<a class="btn" href="tel:${esc(next.customerPhone)}"><i class="bi bi-telephone"></i>Ara</a>` : ""}
            ${next.customerPhone && !reminded.has(next.id) ? `<a class="btn" href="${reminderLink(next)}" target="_blank" rel="noopener" data-remind="${next.id}"><i class="bi bi-whatsapp"></i>Hatırlat</a>` : ""}
            <button class="btn" data-next-open><i class="bi bi-three-dots"></i>Ayrıntı</button>
          </div>
        </div>`;
    } else {
      $("today-next").innerHTML = `<div class="next-card is-empty"><div class="next-label">Sıradaki</div>
        <div class="next-who"><b>${waiting.length || inside.length ? "Bekleyen başka randevu yok" : "Bugün için bekleyen randevu yok"}</b>
        <span>Kapıdan gelen olursa “Sıraya ekle” ile ilk boş saate yaz.</span></div></div>`;
    }

    $("today-stats").innerHTML = [
      [live.length, "randevu", ""], [waiting.length, "bekliyor", "Booked"], [inside.length, "içeride", "Arrived"],
      [live.filter((a) => a.status === "Completed").length, "bitti", "Completed"],
      [money(earned), "kazanılan", "money"], [money(expected), "günün toplamı", "money"]
    ].map(([v, t, k]) => `<div class="stat ${k}"><b>${esc(v)}</b><span>${k && k !== "money" ? '<i class="dot"></i>' : ""}${t}</span></div>`).join("");

    // The rest of the day
    const rest = live.filter((a) => a !== next && (a.status === "Booked" || a.status === "Arrived"))
      .sort((a, b) => mins(a.startsAt) - mins(b.startsAt));
    const finished = live.filter((a) => a.status === "Completed" || a.status === "NoShow");
    $("today-list").innerHTML = rest.length || finished.length
      ? rest.map((a) => apptRow(a, { remind: true })).join("")
        + (finished.length ? `<div class="t-sep">Bitenler</div>` + finished.map((a) => apptRow(a)).join("") : "")
      : `<p class="muted m0">Başka randevu yok.</p>`;

    // Free times for walk-ins
    const free = today$.free;
    $("today-free").innerHTML = !free
      ? `<p class="muted m0">Hizmet tanımlanınca burada görünür.</p>`
      : free.slots.length
        ? `<p class="muted small m0">${esc(free.service.name)} (${free.service.durationMinutes} dk) için:</p>
           <div class="free-times">${free.slots.map((s) => `<button class="slot" data-free="${s.startsAt}" data-staff="${s.staffIds[0] || ""}">${hm(mins(s.startsAt))}</button>`).join("")}</div>`
        : `<p class="muted m0">Bugün boş saat kalmadı.</p>`;

    // Tomorrow's customers, to remind
    const tomorrow = (today$.tomorrow?.appointments || []).filter((a) => a.status === "Booked")
      .sort((a, b) => mins(a.startsAt) - mins(b.startsAt));
    const withPhone = tomorrow.filter((a) => a.customerPhone);
    const left = withPhone.filter((a) => !reminded.has(a.id)).length;
    $("today-remind-count").textContent = tomorrow.length ? `${tomorrow.length} randevu${left ? ` · ${left} hatırlatılmadı` : " · hepsi hatırlatıldı"}` : "";
    $("today-remind").innerHTML = tomorrow.length
      ? tomorrow.map((a) => apptRow(a, { remind: true })).join("")
        + (tomorrow.length > withPhone.length ? `<p class="muted small m0 mt8">Telefonu olmayanlara hatırlatma gönderilemez.</p>` : "")
      : `<p class="muted m0">Yarın için randevu yok.</p>`;

    // The last seven days, for managers
    const week = today$.week;
    $("today-week-card").hidden = !week;
    if (week) {
      const max = Math.max(1, ...week.days.map((d) => d.revenue));
      $("today-week").innerHTML = `<div class="bars">${week.days.map((d) => `
          <div class="bar-col" title="${shortDate(d.date)}: ${money(d.revenue)} · ${d.completed} müşteri">
            <span class="bar-val">${d.revenue ? Math.round(d.revenue).toLocaleString("tr-TR") : ""}</span>
            <span class="bar-fill ${d.date === today() ? "is-today" : ""}" style="height:${Math.max(3, d.revenue / max * 100)}%"></span>
            <span class="bar-label">${toDate(d.date).toLocaleDateString("tr-TR", { weekday: "short" })}</span>
          </div>`).join("")}</div>
        <p class="muted small m0">7 günde ${money(week.revenue)} · ${week.completed} müşteri · gelmeme %${Math.round(week.noShowRate * 100)}</p>`;
    }

    // Wiring
    const root = $("tab-today");
    root.querySelectorAll(".t-row").forEach((r) => r.addEventListener("click", (e) => {
      if (e.target.closest("[data-remind]")) return;
      const all = [...plan.appointments, ...(today$.tomorrow?.appointments || [])];
      showAppointment(all.find((a) => a.id === Number(r.dataset.id)));
    }));
    root.querySelectorAll("[data-remind]").forEach((l) => l.addEventListener("click", () => markReminded(Number(l.dataset.remind))));
    root.querySelectorAll("[data-free]").forEach((b) => b.addEventListener("click", () =>
      newAppointment({ minute: mins(b.dataset.free), date: today(), staffId: b.dataset.staff ? Number(b.dataset.staff) : null })));
    const arrived = root.querySelector("[data-next-status]");
    if (arrived) arrived.addEventListener("click", async () => {
      try { await api("PUT", `/api/appointments/${next.id}/status`, { status: "Arrived" }); await loadToday(); toast(`${firstName(next.customerName)} geldi.`); }
      catch (err) { toast(err.message); }
    });
    const openNext = root.querySelector("[data-next-open]");
    if (openNext) openNext.addEventListener("click", () => showAppointment(next));
  }

  $("today-walk-in").addEventListener("click", () => { state.day = today(); walkIn(); });
  $("today-new").addEventListener("click", () => { state.day = today(); newAppointment({}); });

  // ---------- Müşteriler ----------

  const customers$ = { list: null, filter: "all", search: "" };
  const LAPSED_DAYS = 30;

  async function loadCustomers() {
    if (!customers$.list) $("customer-list").innerHTML = `<p class="muted">Yükleniyor…</p>`;
    await loadServices(false);
    customers$.list = await api("GET", `${base()}/customers`);
    drawCustomers();
  }

  const daysSince = (iso) => iso ? Math.floor((toDate(today()) - toDate(dateOf(iso))) / 86400000) : null;
  const ago = (n) => n == null ? "hiç gelmedi" : n === 0 ? "bugün" : n === 1 ? "dün" : n < 7 ? `${n} gün önce` : n < 60 ? `${Math.round(n / 7)} hafta önce` : `${Math.round(n / 30)} ay önce`;

  function drawCustomers() {
    const list = customers$.list || [];
    const lapsed = (c) => c.visits > 0 && !c.nextAppointment && daysSince(c.lastVisit) >= LAPSED_DAYS;
    const filters = {
      all: () => true,
      regular: (c) => c.visits >= 3,
      lapsed,
      fresh: (c) => c.visits <= 1
    };
    const counts = Object.fromEntries(Object.entries(filters).map(([k, f]) => [k, list.filter(f).length]));
    document.querySelectorAll("#customer-filters [data-filter]").forEach((b) => {
      b.classList.toggle("on", b.dataset.filter === customers$.filter);
      b.querySelector("em").textContent = counts[b.dataset.filter];
    });

    const q = customers$.search.trim().toLocaleLowerCase("tr-TR");
    const shown = list.filter(filters[customers$.filter])
      .filter((c) => !q || c.name.toLocaleLowerCase("tr-TR").includes(q) || String(c.phone || "").replace(/\D/g, "").includes(q.replace(/\D/g, "") || "§"));

    $("customer-summary").textContent = list.length
      ? `${list.length} müşteri · ${counts.regular} müdavim · ${counts.lapsed} kişi ${LAPSED_DAYS} gündür gelmiyor`
      : "";

    $("customer-list").innerHTML = shown.length ? shown.map((c, i) => {
      const since = daysSince(c.lastVisit);
      const missMsg = `Merhaba ${firstName(c.name)}, seni bir süredir ${state.branch.name}'de göremedik. Bu hafta uygun bir saatte bekleriz, randevu için yazabilirsin.`;
      return `<div class="c-row">
        <span class="avatar c${i % 5}">${esc(initials(c.name))}</span>
        <div class="c-main">
          <b>${esc(c.name)}</b>
          <small>${c.visits} ziyaret · son: ${ago(since)}${c.usual ? ` · ${esc(c.usual)}${c.usualStaff ? ` (${esc(c.usualStaff)})` : ""}` : ""}</small>
          <div class="c-tags">
            ${c.nextAppointment ? `<span class="tag">Randevu: ${shortDate(dateOf(c.nextAppointment))} ${hm(mins(c.nextAppointment))}</span>` : ""}
            ${lapsed(c) ? `<span class="tag warn">${since} gündür gelmiyor</span>` : ""}
            ${c.noShows ? `<span class="tag bad">${c.noShows} kez gelmedi</span>` : ""}
            ${isManager() && c.spent ? `<span class="tag soft">${money(c.spent)}</span>` : ""}
          </div>
        </div>
        <div class="c-actions">
          ${c.phone ? `<a class="btn small" href="tel:${esc(c.phone)}" title="Ara"><i class="bi bi-telephone"></i></a>
          <a class="btn small" href="https://wa.me/${phoneDigits(c.phone)}?text=${encodeURIComponent(lapsed(c) ? missMsg : `Merhaba ${firstName(c.name)}, `)}" target="_blank" rel="noopener" title="WhatsApp"><i class="bi bi-whatsapp"></i></a>` : ""}
          <button class="btn small main" data-book="${esc(c.key)}"><i class="bi bi-calendar-plus"></i><span class="lbl">Randevu</span></button>
        </div>
      </div>`;
    }).join("") : `<p class="muted">${list.length ? "Bu filtrede müşteri yok." : "Randevu alındıkça müşterilerin burada listelenir."}</p>`;

    $("customer-list").querySelectorAll("[data-book]").forEach((b) => b.addEventListener("click", async () => {
      const c = list.find((x) => x.key === b.dataset.book);
      state.day = today();
      if (!state.plan || state.plan.date !== today()) state.plan = await api("GET", `${base()}/day?date=${today()}`);
      newAppointment({ name: c.name, phone: c.phone });
    }));
  }

  document.querySelectorAll("#customer-filters [data-filter]").forEach((b) => b.addEventListener("click", () => {
    customers$.filter = b.dataset.filter;
    drawCustomers();
  }));
  $("customer-search").addEventListener("input", (e) => { customers$.search = e.target.value; drawCustomers(); });

  // ---------- Raporlar ----------

  const report$ = { range: "7", data: null };

  function rangeDates(range) {
    const end = today();
    if (range === "month") return [end.slice(0, 8) + "01", end];
    if (range === "lastmonth") {
      const first = toDate(end.slice(0, 8) + "01"); first.setMonth(first.getMonth() - 1);
      const last = toDate(end.slice(0, 8) + "01"); last.setDate(0);
      return [isoDate(first), isoDate(last)];
    }
    return [addDays(end, -(Number(range) - 1)), end];
  }

  async function loadReport() {
    const [from, to] = rangeDates(report$.range);
    document.querySelectorAll("#report-ranges [data-range]").forEach((b) => b.classList.toggle("on", b.dataset.range === report$.range));
    $("report-body").innerHTML = `<p class="muted">Yükleniyor…</p>`;
    report$.data = await api("GET", `${base()}/report?from=${from}&to=${to}`);
    drawReport();
  }

  function lines(items, total) {
    if (!items.length) return `<p class="muted m0">Kayıt yok.</p>`;
    const max = Math.max(1, ...items.map((l) => l.revenue || l.count));
    return items.map((l) => `<div class="r-line">
        <span class="r-name">${esc(l.name)}</span>
        <span class="r-track"><span style="width:${(l.revenue || l.count) / max * 100}%"></span></span>
        <span class="r-num">${total === "count" ? l.count : money(l.revenue)}<small>${l.count} randevu</small></span>
      </div>`).join("");
  }

  function drawReport() {
    const r = report$.data;
    const days = r.days;
    const max = Math.max(1, ...days.map((d) => d.revenue));
    const busiest = r.hours.map((n, h) => [n, h]).filter(([n]) => n > 0);
    const open = busiest.length ? [Math.min(...busiest.map(([, h]) => h)), Math.max(...busiest.map(([, h]) => h))] : [9, 20];
    const hourMax = Math.max(1, ...r.hours);
    const peak = busiest.sort((a, b) => b[0] - a[0])[0];

    $("report-body").innerHTML = `
      <div class="kpis">
        <div class="kpi main"><span>Ciro</span><b>${money(r.revenue)}</b><small>${r.completed} müşteri</small></div>
        <div class="kpi"><span>Ortalama</span><b>${money(r.averageTicket)}</b><small>müşteri başı</small></div>
        <div class="kpi"><span>Randevu</span><b>${r.appointments}</b><small>${r.cancelled} iptal</small></div>
        <div class="kpi ${r.noShowRate > 0.1 ? "bad" : ""}"><span>Gelmeme</span><b>%${Math.round(r.noShowRate * 100)}</b><small>${r.noShows} kişi</small></div>
        <div class="kpi"><span>Müşteri</span><b>${r.newCustomers + r.returningCustomers}</b><small>${r.newCustomers} yeni · ${r.returningCustomers} dönen</small></div>
      </div>

      <div class="card">
        <h2>Günlük ciro</h2>
        <div class="bars ${days.length > 14 ? "dense" : ""}">${days.map((d) => `
          <div class="bar-col" title="${shortDate(d.date)}: ${money(d.revenue)} · ${d.completed} müşteri">
            ${days.length <= 14 ? `<span class="bar-val">${d.revenue ? Math.round(d.revenue).toLocaleString("tr-TR") : ""}</span>` : ""}
            <span class="bar-fill ${d.date === today() ? "is-today" : ""}" style="height:${Math.max(2, d.revenue / max * 100)}%"></span>
            <span class="bar-label">${days.length <= 14 ? toDate(d.date).toLocaleDateString("tr-TR", { weekday: "short" }) : (toDate(d.date).getDate() % 5 === 1 ? toDate(d.date).getDate() : "")}</span>
          </div>`).join("")}</div>
      </div>

      <div class="report-grid">
        <div class="card">
          <h2>Yoğun saatler</h2>
          <div class="hours">${r.hours.slice(open[0], open[1] + 1).map((n, i) => `
            <div class="hour" title="${hm((open[0] + i) * 60)}: ${n} randevu">
              <span class="hour-fill" style="opacity:${n ? 0.18 + 0.82 * n / hourMax : 0.06}"></span>
              <span class="hour-label">${pad(open[0] + i)}</span>
            </div>`).join("")}</div>
          <p class="muted small m0">${peak ? `En yoğun saat ${pad(peak[1])}:00–${pad(peak[1] + 1)}:00 (${peak[0]} randevu).` : "Bu dönemde randevu yok."}</p>
        </div>
        <div class="card"><h2>Çalışanlar</h2>${lines(r.staff)}</div>
        <div class="card"><h2>Hizmetler</h2>${lines(r.services)}</div>
        <div class="card"><h2>Randevu nereden geldi</h2>${lines(r.sources, "count")}</div>
      </div>`;
  }

  document.querySelectorAll("#report-ranges [data-range]").forEach((b) => b.addEventListener("click", () => {
    report$.range = b.dataset.range;
    loadReport().catch((err) => toast(err.message));
  }));


  async function start() {
    $("l-code").value = store.get("code") || "";
    $("l-user").value = store.get("user") || "";
    if (!state.token) { show("login"); return; }
    try {
      state.me = await api("GET", "/api/me");
      await enter();
    } catch (err) {
      if (state.token) signOut(err.message === "Oturum kapandı." ? "" : err.message);
    }
  }

  start();
})();

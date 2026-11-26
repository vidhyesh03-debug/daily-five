// Daily Five: phone + laptop app. Every data call goes through the app_* database functions,
// which only ever return or change the signed-in person's own data.
(() => {
  "use strict";
  const CFG = window.DAILY_FIVE;
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const STATUSES = [
    ["saved", "Saved"], ["applied", "Applied"], ["interviewing", "Interviewing"], ["offer", "Offer"],
    ["rejected", "Rejected"], ["withdrawn", "Withdrawn"], ["archived", "Not for me"],
  ];
  const STATUS_LABEL = Object.fromEntries(STATUSES);
  const VIEWS = ["today", "jobs", "applied", "profile"];
  const SECTORS = ["AI", "Software & SaaS", "Fintech & payments", "E-commerce & marketplaces", "Food & delivery",
    "Beverages", "Fashion & retail", "Marketing, PR & advertising", "Media, gaming & entertainment",
    "Education", "Travel & mobility", "Other"];
  const state = { me: null, home: null, jobs: null, apps: null, settings: null, admin: null,
                  filter: "all", q: "", jobsMode: "jobs", sector: "all", openSectors: new Set(),
                  focusJob: null, view: null, pendingResume: null, dictionary: null, showSenior: false };

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "checked" || k === "selected" || k === "disabled") n[k] = !!v;
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : String(k));
    return n;
  }
  const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);
  const fmtDate = (iso, opts) => { try { return new Date(iso).toLocaleString("en-IN", opts); } catch { return ""; } };
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2800);
  }
  const list = (s) => String(s || "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const joinList = (a) => (Array.isArray(a) ? a.join(", ") : "");

  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw error;
    return data;
  }
  function errText(e) {
    const m = (e && (e.message || e.error_description)) || String(e || "Something went wrong");
    if (/failed to fetch|networkerror|load failed/i.test(m)) return "You seem to be offline. Check your connection and try again.";
    if (/invalid login credentials/i.test(m)) return "Wrong email or password.";
    if (/user already registered/i.test(m)) return "This email already has an account. Choose “I have an account” and sign in.";
    if (/jwt expired/i.test(m)) return "Your sign-in expired. Sign in again.";
    return m;
  }
  function busy(btn, on) { if (btn) btn.disabled = on; }

  // ---------- screens ----------
  function showOnly(id) {
    for (const s of document.querySelectorAll("main section")) s.hidden = s.id !== id;
  }
  function setSignedInChrome(on) {
    $("tabs").hidden = !on; $("who").hidden = !on;
    if (on && state.me) $("who-email").textContent = state.me.email || "";
  }

  async function boot() {
    const { data } = await sb.auth.getSession();
    if (!data.session) return showAuth();
    await afterSignIn();
  }

  async function afterSignIn() {
    try {
      state.me = await rpc("app_me");
    } catch (e) {
      return showAuth(errText(e));
    }
    if (!state.me.member) { setSignedInChrome(false); return showClaim(); }
    setSignedInChrome(true);
    if (!state.me.configured) { location.hash = "profile"; }
    route();
  }

  // ---------- sign in / sign up ----------
  let authMode = "signin";
  function setAuthMode(m) {
    authMode = m;
    $("mode-signin").setAttribute("aria-pressed", m === "signin");
    $("mode-signup").setAttribute("aria-pressed", m === "signup");
    $("code-field").hidden = m !== "signup";
    $("pw-hint").hidden = m !== "signup";
    $("auth-title").textContent = m === "signup" ? "Create your account" : "Sign in";
    $("auth-sub").textContent = m === "signup"
      ? "Use the email you were invited with, choose a password, and enter your invite code."
      : "Five jobs worth applying to, every morning.";
    $("auth-submit").textContent = m === "signup" ? "Create account" : "Sign in";
    $("auth-password").autocomplete = m === "signup" ? "new-password" : "current-password";
    $("auth-error").textContent = "";
  }
  function showAuth(message) {
    setSignedInChrome(false);
    setAuthMode("signin");
    showOnly("view-auth");
    $("auth-error").textContent = message || "";
  }
  function showClaim() {
    showOnly("view-claim");
    $("claim-email").textContent = state.me?.email || "";
  }
  $("mode-signin").addEventListener("click", () => setAuthMode("signin"));
  $("mode-signup").addEventListener("click", () => setAuthMode("signup"));

  $("auth-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("auth-email").value.trim(), password = $("auth-password").value;
    const code = $("auth-code").value.trim();
    const err = $("auth-error"); err.textContent = "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return (err.textContent = "Enter your email address.");
    if (password.length < 8) return (err.textContent = "Your password needs at least 8 characters.");
    if (authMode === "signup" && !code) return (err.textContent = "Enter the invite code you were given.");
    const btn = $("auth-submit"); busy(btn, true);
    try {
      if (authMode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          err.textContent = "Account created, but this app is set to require an email confirmation link. " +
            "Ask the person who invited you to switch off “Confirm email” in Supabase, then sign in.";
          return;
        }
        try {
          state.me = await rpc("app_claim_invite", { p_code: code });
        } catch (claimErr) {
          // The account exists now; let them retry the code without signing up again.
          state.me = await rpc("app_me").catch(() => ({ email }));
          $("auth-password").value = "";
          showClaim();
          $("claim-code").value = code;
          $("claim-error").textContent = errText(claimErr);
          return;
        }
        toast(state.me.configured ? "Welcome!" : "Welcome! Let's set up your profile.");
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      $("auth-password").value = "";
      await afterSignIn();
    } catch (e) {
      err.textContent = errText(e);
    } finally { busy(btn, false); }
  });

  $("claim-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const err = $("claim-error"); err.textContent = "";
    try {
      state.me = await rpc("app_claim_invite", { p_code: $("claim-code").value.trim() });
      await afterSignIn();
    } catch (e) { err.textContent = errText(e); }
  });

  $("signout").addEventListener("click", async () => {
    await sb.auth.signOut();
    Object.assign(state, { me: null, home: null, jobs: null, apps: null, settings: null, admin: null });
    try { localStorage.removeItem("d5:home"); } catch {}
    showAuth();
  });

  // ---------- job card ----------
  function fitBadge(j) {
    if (j.score == null) return null; // no resume = no score, by design
    const s = j.score;
    return el("div", { class: s >= 80 ? "fit good" : s >= 60 ? "fit ok" : "fit", title: "Fit score out of 100" },
      el("b", { text: String(s) }), el("small", { text: "fit" }));
  }
  function bullets(items, heading) {
    if (!Array.isArray(items) || !items.length) return null;
    return el("div", {}, el("h4", { text: heading }), el("ul", {}, items.map((t) => el("li", { text: t }))));
  }
  // How a job's experience requirement compares with yours
  function myYears() { return state.home?.years_experience ?? state.settings?.years_experience ?? null; }
  function expFit(j) {
    const y = j.years_required, mine = myYears();
    if (y == null) return null;
    if (mine == null) return { cls: "", text: `Asks ${y}+ yrs` };
    if (y <= mine + 1) return { cls: "good", text: `Asks ${y}+ yrs · fits you` };
    if (y <= mine + 2) return { cls: "stretch", text: `Asks ${y}+ yrs · a stretch` };
    return { cls: "warn", text: `Asks ${y}+ yrs · needs more experience` };
  }
  const tooSenior = (j) => { const f = expFit(j); return !!f && f.cls === "warn"; };

  // ---------- Job details (ⓘ) ----------
  // Turns a long job post into short sections: the role, what they want, benefits, about the company.
  function summarizeJob(text, highlights) {
    const out = { role: [], wants: [], perks: [], about: "" };
    const clean = (t) => t.replace(/^\s*(?:[•*\-–·●▪◦]+|\d{1,2}[.)])\s*/, "").replace(/\s+/g, " ").trim();
    const short = (t) => (t.length > 170 ? t.slice(0, 167).trimEnd() + "…" : t);
    if (highlights && typeof highlights === "object") {
      out.role = (highlights.Responsibilities || []).map(clean).filter(Boolean).slice(0, 5).map(short);
      out.wants = (highlights.Qualifications || []).map(clean).filter(Boolean).slice(0, 5).map(short);
      out.perks = (highlights.Benefits || []).map(clean).filter(Boolean).slice(0, 4).map(short);
    }
    const lines = String(text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const H = [
      ["role", /(responsib|what you('|’)ll do|what you will do|the role|your role|day[- ]to[- ]day|key result|in this role|the opportunity|what you('|’)ll be doing)/i],
      ["wants", /(requirement|qualif|what you('|’)ll bring|what we('|’)re looking for|who you are|you have|skills|must have|about you|what you bring|ideal candidate|experience)/i],
      ["perks", /(benefit|perks|what we offer|why join|compensation|why you('|’)ll love)/i],
      ["about", /^(about|who we are|our company|company overview)/i],
    ];
    let section = "intro"; const found = { intro: [], role: [], wants: [], perks: [], about: [] };
    for (const line of lines) {
      const isHeading = line.length < 70 && !/[.!?]$/.test(line) && H.some(([, re]) => re.test(line));
      if (isHeading) { section = H.find(([, re]) => re.test(line))[0]; continue; }
      found[section].push(line);
    }
    if (!out.role.length) out.role = found.role.map(clean).filter((t) => t.length > 3).slice(0, 5).map(short);
    // Text before the first heading usually describes the job, unless it's the company blurb
    if (!out.role.length) out.role = found.intro.map(clean)
      .filter((t) => t.length > 25 && /(you will|you'll|as an? |this role|the role|responsib|we are looking|we're looking|join)/i.test(t))
      .slice(0, 3).map(short);
    if (!out.wants.length) out.wants = found.wants.map(clean).filter((t) => t.length > 3).slice(0, 5).map(short);
    if (!out.perks.length) out.perks = found.perks.map(clean).filter((t) => t.length > 3).slice(0, 4).map(short);
    out.about = short(clean((found.about.join(" ") || "").split(/(?<=[.!?])\s+/).slice(0, 2).join(" ")));
    if (!out.role.length && !out.wants.length) {
      // No headings: take the first few sentences that talk about the job.
      const sentences = String(text || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).filter((t) => t.length > 30);
      out.role = sentences.filter((t) => /(you will|you'll|responsib|manage|own|drive|build|work with|support)/i.test(t)).slice(0, 4).map(short);
      out.wants = sentences.filter((t) => /(years|experience|degree|skills?|knowledge|ability|proficien)/i.test(t)).slice(0, 4).map(short);
      if (!out.role.length) out.role = sentences.slice(0, 3).map(short);
    }
    return out;
  }
  async function openJobDetails(jobId, btn) {
    const dlg = $("job-dialog"), box = $("job-dialog-body");
    box.replaceChildren(el("div", { class: "skeleton" }));
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    try {
      const d = await rpc("app_job_detail", { p_job_id: jobId });
      if (!d) throw new Error("This job is no longer available.");
      const sum = summarizeJob(d.description, d.highlights);
      const fit = expFit(d);
      const chips = el("div", { class: "chips" },
        d.location ? el("span", { class: "chip", text: d.location }) : null,
        d.work_mode && d.work_mode !== "unknown" ? el("span", { class: "chip", text: d.work_mode[0].toUpperCase() + d.work_mode.slice(1) }) : null,
        d.employment_type ? el("span", { class: "chip", text: String(d.employment_type).replace(/_/g, " ").toLowerCase() }) : null,
        fit ? el("span", { class: "chip " + fit.cls, text: fit.text }) : null,
        d.salary_min || d.salary_max ? el("span", { class: "chip", text: `Pay ${d.salary_min ?? "?"}–${d.salary_max ?? "?"} ${d.salary_currency || ""}`.trim() }) : null,
        d.publisher ? el("span", { class: "chip", text: "via " + d.publisher }) : null);
      const section = (title, items) => items && items.length
        ? el("section", { class: "jd-section" }, el("h4", { text: title }), el("ul", {}, items.map((t) => el("li", { text: t })))) : null;
      const url = safeUrl(d.url);
      box.replaceChildren(...[
        el("p", { class: "co-line" }, el("span", { class: "co", text: d.company }), d.sector ? el("span", { text: "· " + d.sector }) : null),
        el("h2", { class: "title", id: "job-dialog-title", text: d.title }),
        chips,
        d.score != null ? el("p", { class: "summary", text: `Fit ${d.score}/100. ${d.summary || ""}` }) : null,
        section("The role", sum.role),
        section("What they're looking for", sum.wants),
        section("Benefits", sum.perks),
        sum.about ? el("section", { class: "jd-section" }, el("h4", { text: "About " + d.company }), el("p", { text: sum.about })) : null,
        !sum.role.length && !sum.wants.length ? el("p", { class: "hint", text: "This posting has no description we can summarise. Open the posting for full details." }) : null,
        el("p", { class: "hint", text: "A short summary of the job post. Open the posting for the full description." }),
        el("div", { class: "actions" },
          url ? el("a", { class: "btn primary", href: url, target: "_blank", rel: "noopener noreferrer", text: "Open posting ↗" }) : null,
          el("button", { class: "btn", type: "button", "data-act": "close-dialog", text: "Close" }))].filter(Boolean));
    } catch (e) {
      box.replaceChildren(el("p", { class: "formerr", text: errText(e) }),
        el("button", { class: "btn", type: "button", "data-act": "close-dialog", text: "Close" }));
    }
  }

  function jobRow(j, opts = {}) {
    const art = el("article", { class: "job" + (opts.rank ? "" : " norank") + (j.dismissed ? " dim" : ""), "data-job": j.job_id });
    const star = el("button", { class: "star", type: "button", "aria-pressed": j.favourite ? "true" : "false",
      "aria-label": (j.favourite ? "Unstar " : "Star ") + j.company, "data-act": "fav", "data-company": j.company_id, text: "★" });
    art.append(
      el("div", { class: "rank", text: opts.rank ? String(opts.rank) : "" }),
      el("div", { class: "co-line" }, star, el("span", { class: "co", text: j.company }), j.industry ? el("span", { text: "· " + j.industry }) : null),
      fitBadge(j) || el("span"),
      el("h3", { class: "title", text: j.title }));

    const chips = el("div", { class: "chips" });
    if (j.location) chips.append(el("span", { class: "chip", text: j.location }));
    if (j.work_mode && j.work_mode !== "unknown") chips.append(el("span", { class: "chip", text: j.work_mode[0].toUpperCase() + j.work_mode.slice(1) }));
    const fit = expFit(j);
    if (fit) chips.append(el("span", { class: "chip " + fit.cls, text: fit.text }));
    if (j.publisher) chips.append(el("span", { class: "chip", text: "via " + j.publisher }));
    if (j.status) chips.append(el("span", { class: "chip status " + j.status, text: STATUS_LABEL[j.status] || j.status }));
    if (j.first_seen) chips.append(el("span", { class: "chip", text: "Found " + fmtDate(j.first_seen, { day: "numeric", month: "short" }) }));

    const body = el("div", { class: "body" }, chips);
    if (j.snippet) body.append(el("p", { class: "snippet", text: j.snippet }));
    if (j.score != null && j.summary) body.append(el("p", { class: "summary", text: j.summary }));
    const plus = j.score != null ? bullets(j.strengths, "Works for you") : null;
    const minus = j.score != null ? bullets(j.gaps, "Watch out for") : null;
    if (plus || minus) body.append(el("details", {}, el("summary", { text: "Why this score" }),
      el("div", { class: "why" }, plus, minus),
      el("p", { class: "by", text: "Scored with simple rules: job title, years asked for, location, and skills from your resume and profile." })));

    const actions = el("div", { class: "actions" });
    const url = safeUrl(j.url);
    actions.append(el("button", { class: "btn info", type: "button", "data-act": "info", "aria-label": "Job details for " + j.title, text: "ⓘ Details" }));
    if (url) actions.append(el("a", { class: "btn primary", href: url, target: "_blank", rel: "noopener noreferrer", text: "Open posting ↗" }));
    if (opts.manage) {
      body.append(actions, manageTools(j));
    } else {
      const st = j.status;
      actions.append(
        el("button", { class: "btn" + (st === "saved" ? " on" : ""), type: "button", "data-act": "status", "data-status": "saved", text: st === "saved" ? "Saved" : "Save" }),
        el("button", { class: "btn" + (st === "applied" ? " on" : ""), type: "button", "data-act": "status", "data-status": "applied", text: st === "applied" ? "Applied ✓" : "Mark applied" }),
        opts.pickId && !j.dismissed
          ? el("button", { class: "btn ghost", type: "button", "data-act": "skip", "data-pick": opts.pickId, text: "Skip" })
          : opts.pickId ? null : el("button", { class: "btn ghost", type: "button", "data-act": "status", "data-status": "archived", text: "Not for me" }));
      body.append(actions);
    }
    art.append(body);
    return art;
  }
  function manageTools(j) {
    const sel = el("select", { id: "status-" + j.job_id, "data-act": "select-status" },
      STATUSES.map(([v, label]) => el("option", { value: v, text: label, selected: v === j.status })));
    const note = el("textarea", { id: "note-" + j.job_id, placeholder: "Notes: referral, recruiter, interview date…" });
    note.value = j.notes || "";
    const hist = (j.history || []).map((h) => (STATUS_LABEL[h.status] || h.status) + " " + fmtDate(h.at, { day: "numeric", month: "short" })).join("  →  ");
    return el("div", { class: "app-tools" },
      el("div", {}, el("label", { for: "status-" + j.job_id, text: "Status" }), sel),
      el("div", {}, el("label", { for: "note-" + j.job_id, text: "Notes" }), note,
        el("div", { style: "margin-top:6px" }, el("button", { class: "btn", type: "button", "data-act": "save-note", text: "Save note" }))),
      hist ? el("div", { class: "history", style: "grid-column:1/-1", text: hist }) : null);
  }
  function errorPanel(e, retry) {
    const b = el("button", { class: "btn primary", type: "button", text: "Try again" });
    b.addEventListener("click", retry);
    return el("div", { class: "panel error", role: "alert" }, el("h2", { text: "Couldn't load this" }), el("p", { text: errText(e) }), b);
  }

  // ---------- Today ----------
  function renderToday() {
    const h = state.home, box = $("today-body");
    if (!h) return;
    const apps = h.applications || {};
    const applied = (apps.applied || 0) + (apps.interviewing || 0) + (apps.offer || 0);
    const live = (h.picks || []).filter((p) => !p.dismissed);
    const kids = [
      el("p", { class: "lede", text: live.length
        ? (h.has_resume ? "Five companies to apply to today, best fit first." : "Five companies hiring for your roles today.")
        : (h.picks || []).length ? "You've cleared today's list. New picks arrive after 7 am." : "No picks yet today." }),
      el("div", { class: "strip" },
        el("span", {}, el("b", { text: String(h.open_matching ?? "–") }), " matching jobs open"),
        el("span", {}, el("b", { text: String(h.new_24h ?? "–") }), " new in 24 hours"),
        el("span", {}, el("b", { text: String(applied) }), " applied so far"),
        h.last_fetch ? el("span", { text: "Updated " + fmtDate(h.last_fetch, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) }) : null),
    ];
    if (!h.has_resume) kids.push(el("p", { class: "hint", text: "You're browsing without a resume, so jobs aren't scored. Add one in Profile any time for fit scores." }));
    for (const p of h.picks || []) kids.push(jobRow(p, { rank: p.rank, pickId: p.pick_id }));
    if (!(h.picks || []).length) kids.push(el("p", { class: "empty", text:
      h.open_matching ? "Picks are built each morning from jobs found overnight." :
      "No matching jobs yet. New members' jobs appear after the next overnight search; check that your city and roles in Profile are right." }));
    box.replaceChildren(...kids);
  }

  // ---------- All jobs / Companies ----------
  function jobMatches(j) {
    const f = state.filter, q = state.q.trim().toLowerCase();
    const city = (state.home?.city || "").toLowerCase();
    if (f === "fav" && !j.favourite) return false;
    if (f === "city" && !(city && (j.location || "").toLowerCase().includes(city))) return false;
    if (f === "remote" && j.work_mode !== "remote" && !/remote/i.test(j.location || "")) return false;
    if (f === "new" && j.status) return false;
    if (!state.showSenior && tooSenior(j)) return false;
    if (q && !(j.company + " " + j.title).toLowerCase().includes(q)) return false;
    return true;
  }
  // Group into sector sections. Sections start folded (tap to open) unless the list is short
  // or you're searching, so the screen opens as a tidy table of contents.
  function sectionsOf(rows, keyOf) {
    const by = new Map();
    for (const r of rows) { const k = keyOf(r) || "Other"; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
    return [...by.entries()].sort((a, b) => SECTORS.indexOf(a[0]) - SECTORS.indexOf(b[0]));
  }
  function sectorChips(all) {
    const counts = new Map();
    for (const j of all) counts.set(j.sector || "Other", (counts.get(j.sector || "Other") || 0) + 1);
    const chips = [el("button", { type: "button", "data-act": "sector", "data-sector": "all", "aria-pressed": state.sector === "all" ? "true" : "false", text: "All sections" })];
    for (const sec of SECTORS) if (counts.has(sec)) chips.push(el("button", { type: "button", "data-act": "sector", "data-sector": sec,
      "aria-pressed": state.sector === sec ? "true" : "false", text: `${sec} · ${counts.get(sec)}` }));
    return el("div", { class: "seg sector-chips", role: "group", "aria-label": "Sections" }, chips);
  }
  function sectionBlock(name, count, unit, children, forceOpen) {
    const d = el("details", { class: "sector", "data-sector": name });
    d.open = forceOpen || state.openSectors.has(name);
    d.append(el("summary", {}, el("span", { class: "sector-name", text: name }), el("span", { class: "sector-count", text: `${count} ${count === 1 ? unit : unit === "company" ? "companies" : unit + "s"}` })),
      el("div", { class: "sector-body" }, children));
    d.addEventListener("toggle", () => { if (d.open) state.openSectors.add(name); else state.openSectors.delete(name); });
    return d;
  }
  function companyButton(c) {
    return el("button", { class: "company", type: "button", "data-act": "open-company", "data-name": c.name },
      el("span", {}, el("b", { text: (c.fav ? "★ " : "") + c.name }),
        el("div", { class: "hint", text: "Newest role found " + fmtDate(c.newest, { day: "numeric", month: "short" }) })),
      el("span", { class: "count", text: c.n + (c.n === 1 ? " role" : " roles") }));
  }
  function renderJobs() {
    if (!state.jobs) return;
    $("n-jobs").textContent = String(state.jobs.length);
    $("f-city-btn").textContent = state.home?.city || "My city";
    const box = $("jobs-body");

    // Opened from an alert: show that one job first
    if (state.focusJob) {
      const j = state.jobs.find((x) => x.job_id === state.focusJob);
      const back = el("button", { class: "btn", type: "button", "data-act": "unfocus", text: "See all jobs" });
      box.replaceChildren(j
        ? el("div", { class: "list" }, el("p", { class: "lede", text: "From your morning alert" }), jobRow(j), back)
        : el("div", { class: "panel" }, el("h2", { text: "That job is no longer open" }), el("p", { text: "It was filled or taken down since the alert was sent." }), back));
      return;
    }

    const matching = state.jobs.filter(jobMatches);
    const rows = state.sector === "all" ? matching : matching.filter((j) => (j.sector || "Other") === state.sector);
    const searching = !!state.q.trim() || state.sector !== "all" || rows.length <= 12;
    const kids = [sectorChips(matching)];
    const hidden = state.showSenior ? 0 : state.jobs.filter((j) => tooSenior(j)).length;
    if (hidden || state.showSenior) kids.push(el("p", { class: "hint" },
      state.showSenior ? "Showing roles that ask for more experience than you have. " : `${hidden} role${hidden === 1 ? " needs" : "s need"} more experience than your ${myYears()} years, so they're hidden. `,
      el("button", { class: "linkish", type: "button", "data-act": "show-senior", text: state.showSenior ? "Hide them" : "Show them" })));
    if (!rows.length) {
      kids.push(el("p", { class: "empty", text: "No jobs match this filter." }));
    } else if (state.jobsMode === "companies") {
      for (const [sec, list] of sectionsOf(rows, (j) => j.sector)) {
        const by = new Map();
        for (const j of list) {
          const c = by.get(j.company_id) || { name: j.company, fav: j.favourite, n: 0, newest: j.first_seen };
          c.n++; if (j.first_seen > c.newest) c.newest = j.first_seen; by.set(j.company_id, c);
        }
        const cos = [...by.values()].sort((a, b) => (b.fav - a.fav) || (b.n - a.n) || a.name.localeCompare(b.name));
        kids.push(sectionBlock(sec, cos.length, "company", el("div", { class: "list" }, cos.map(companyButton)), searching));
      }
    } else {
      for (const [sec, list] of sectionsOf(rows, (j) => j.sector)) {
        kids.push(sectionBlock(sec, list.length, "job", el("div", { class: "list grid" }, list.map((j) => jobRow(j))), searching));
      }
    }
    box.classList.remove("grid");
    box.replaceChildren(...kids);
  }

  // ---------- Applications ----------
  function renderApplied() {
    if (!state.apps) return;
    const active = state.apps.filter((a) => !["rejected", "withdrawn", "archived"].includes(a.status));
    $("n-applied").textContent = active.length ? String(active.length) : "";
    if (!state.apps.length) {
      $("applied-body").replaceChildren(el("div", { class: "panel" }, el("h2", { text: "Nothing tracked yet" }),
        el("p", { text: "Tap Save or Mark applied on any job and it appears here, with its status history and your notes." })));
      return;
    }
    const kids = [];
    for (const s of ["interviewing", "offer", "applied", "saved", "rejected", "withdrawn", "archived"]) {
      const rows = state.apps.filter((a) => a.status === s);
      if (!rows.length) continue;
      kids.push(el("h2", { class: "group-h", text: STATUS_LABEL[s] + " · " + rows.length }), ...rows.map((a) => jobRow(a, { manage: true })));
    }
    $("applied-body").replaceChildren(...kids);
  }

  // ---------- Profile ----------
  function field(id, label, value, hint, attrs = {}) {
    const input = attrs.multiline
      ? el("textarea", { id, rows: attrs.rows || 2, placeholder: attrs.placeholder || "" })
      : el("input", { id, type: attrs.type || "text", placeholder: attrs.placeholder || "", min: attrs.min, max: attrs.max, maxlength: attrs.maxlength });
    input.value = value ?? "";
    return el("div", { class: "field" }, el("label", { for: id, text: label }), input, hint ? el("div", { class: "hint", text: hint }) : null);
  }
  function timezoneSelect(current) {
    let zones = [];
    try { zones = Intl.supportedValuesOf("timeZone"); } catch { zones = []; }
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const value = current && current !== "UTC" ? current : device;
    if (!zones.length) return field("f-tz", "Time zone", value, "For example Asia/Kolkata.");
    if (!zones.includes(value)) zones.unshift(value);
    const sel = el("select", { id: "f-tz" }, zones.map((z) => el("option", { value: z, text: z.replace(/_/g, " "), selected: z === value })));
    return el("div", { class: "field" }, el("label", { for: "f-tz", text: "Time zone" }), sel, el("div", { class: "hint", text: "Your five picks arrive after 7 am in this time zone." }));
  }

  function renderProfile() {
    const s = state.settings || {};
    const first = !s.configured;
    const hasResume = !!s.resume_label;
    const kids = [];
    if (first) kids.push(el("div", { class: "panel" }, el("h2", { text: "Welcome! Tell us what you're looking for" }),
      el("p", { text: "Fill in your city and the job titles you want. Every night the app searches company job boards and picks five for you each morning. Adding a resume is optional." })));

    const form = el("form", { class: "panel", id: "profile-form", novalidate: true },
      el("h2", { text: "Where and what" }),
      el("div", { class: "grid2" },
        field("f-city", "City (and other names for it)", joinList(s.city_names), "Comma separated, e.g. Bengaluru, Bangalore", { placeholder: "Bengaluru, Bangalore" }),
        field("f-country", "Country", s.country_name, null, { placeholder: "India" }),
        field("f-code", "Country code", s.country_code, "2 letters, e.g. IN, US, GB", { placeholder: "IN", maxlength: 2 }),
        timezoneSelect(s.timezone),
        field("f-years", "Years of experience", s.years_experience ?? 2, null, { type: "number", min: 0, max: 50 })),
      field("f-roles", "Job titles you want", joinList(s.role_keywords), "Comma separated. Matches the start of words, so “client servic” finds “client servicing”.",
        { multiline: true, rows: 3, placeholder: "account executive, account manager, customer success, business development, sales" }),
      field("f-best", "Best-fit titles (optional)", joinList(s.best_fit_keywords), "These score a little higher.", { multiline: true, placeholder: "account executive, key account manager" }),
      field("f-exclude", "Words that rule a title out (optional)", joinList(s.exclude_keywords), null, { multiline: true, placeholder: "engineer, developer, intern" }),
      field("f-regions", "Remote jobs open to (optional)", joinList(s.remote_regions), "Countries or regions a remote job must mention.", { placeholder: "india, apac, anywhere, worldwide" }),
      field("f-skills", "Your skills (optional)", joinList(s.skills), "Used for fit scores when you add a resume.", { multiline: true, placeholder: "b2b, crm, hubspot, negotiation, lead generation" }));

    // ---- resume: attach a file; it's read on this device ----
    const useResume = el("input", { type: "radio", name: "resume-mode", id: "r-use", value: "use", checked: hasResume || undefined });
    const noResume = el("input", { type: "radio", name: "resume-mode", id: "r-none", value: "none", checked: !hasResume || undefined });
    const current = hasResume ? el("p", { class: "hint", id: "resume-current", text: s.resume_storage === "skills_only"
        ? `Using ${(s.resume_skills || []).length} skills from “${s.resume_label}”. Your resume file was never uploaded.`
        : `Using the full text of “${s.resume_label}”, saved privately in your account.` }) : null;
    const fileInput = el("input", { type: "file", id: "f-resume-file", accept: ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" });
    const pasteBox = el("textarea", { id: "f-resume", rows: 6, placeholder: "Paste the text of your resume here." });
    const pasteWrap = el("div", { class: "field", hidden: true }, el("label", { for: "f-resume", text: "Resume text" }), pasteBox);
    const pasteLink = el("button", { class: "linkish", type: "button", text: "Can't attach the file? Paste the text instead" });
    pasteLink.addEventListener("click", () => { pasteWrap.hidden = false; pasteLink.hidden = true; });
    pasteBox.addEventListener("input", () => resumeFromText(pasteBox.value.trim(), "Pasted resume"));
    fileInput.addEventListener("change", () => fileInput.files[0] && resumeFromFile(fileInput.files[0]));
    const keepSkills = el("input", { type: "radio", name: "resume-keep", id: "k-skills", value: "skills", checked: true });
    const keepFull = el("input", { type: "radio", name: "resume-keep", id: "k-full", value: "full" });
    const resumeBox = el("div", { id: "resume-box", class: "field" },
      current,
      el("div", { class: "file-drop" },
        el("label", { for: "f-resume-file", class: "label", text: hasResume ? "Replace with a new resume (PDF or Word .docx)" : "Attach your resume (PDF or Word .docx)" }),
        fileInput,
        el("div", { id: "resume-status", class: "hint", role: "status" }),
        el("div", { id: "resume-skills", class: "skills" })),
      pasteLink, pasteWrap,
      el("div", { id: "resume-keep", hidden: true },
        el("label", { class: "choice", for: "k-skills" }, keepSkills, el("div", {}, el("b", { text: "Save only the skills found (recommended)" }),
          el("span", { text: "Your resume stays on this device. Only the skill words above are saved, and scores work the same." }))),
        el("label", { class: "choice", for: "k-full" }, keepFull, el("div", {}, el("b", { text: "Save the full resume text" }),
          el("span", { text: "Stored privately in your account. Only you can see it." })))));
    resumeBox.hidden = !hasResume;
    state.pendingResume = null;
    form.append(el("h2", { text: "Resume (optional)" }),
      el("label", { class: "choice", for: "r-none" }, noResume, el("div", {}, el("b", { text: "No resume: just show me who's hiring" }), el("span", { text: "Picks are based on your job titles. No fit scores." }))),
      el("label", { class: "choice", for: "r-use" }, useResume, el("div", {}, el("b", { text: "Use my resume for fit scores" }), el("span", { text: "Each job gets a score out of 100 with reasons." }))),
      resumeBox,
      el("div", { class: "formerr", id: "profile-error", role: "alert" }),
      el("div", { class: "actions" }, el("button", { class: "btn primary", type: "submit", id: "profile-save", text: first ? "Save and see my jobs" : "Save changes" })));
    for (const r of [useResume, noResume]) r.addEventListener("change", () => { resumeBox.hidden = !useResume.checked; });
    form.addEventListener("submit", saveProfile);
    kids.push(form);

    if (!first) {
      // follow a company
      const sectorSel = el("select", { id: "c-sector" }, SECTORS.map((x) => el("option", { value: x, text: x, selected: x === "Other" })));
      const addForm = el("form", { class: "panel", id: "company-form", novalidate: true },
        el("h2", { text: "Follow a company" }),
        el("p", { text: "Works for companies that post jobs on Greenhouse, Lever or Ashby. Paste their careers link if you have it. New companies are checked overnight." }),
        el("div", { class: "grid2" }, field("c-name", "Company name", "", null, { placeholder: "Acme" }), field("c-url", "Careers link (optional)", "", null, { placeholder: "https://jobs.lever.co/acme", type: "url" }),
          el("div", { class: "field" }, el("label", { for: "c-sector", text: "Section" }), sectorSel)),
        el("div", { class: "formerr", id: "company-error", role: "alert" }),
        el("div", { class: "actions" }, el("button", { class: "btn", type: "submit", text: "Follow" })),
        el("p", { class: "hint", text: `Searching ${s.boards_active ?? "–"} company job boards nightly${s.boards_pending ? `, ${s.boards_pending} waiting for their first check` : ""}.` }));
      addForm.addEventListener("submit", addCompany);
      kids.push(addForm, alertsPanel(s), privacyPanel(s));
    }
    if (state.me?.role === "owner" && !first) kids.push(renderAdmin());
    $("profile-body").replaceChildren(...kids);
  }

  // ---------- resume reading (on this device) ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const sc = document.createElement("script"); sc.src = src; sc.onload = resolve;
      sc.onerror = () => reject(new Error("Couldn't load the file reader. Check your connection."));
      document.head.append(sc);
    });
  }
  function wordXmlToText(xml) {
    const div = document.createElement("div");
    const t = xml.replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");
    div.innerHTML = t.replace(/</g, "&lt;"); // decode entities only
    return div.textContent.replace(/\n{3,}/g, "\n\n").trim();
  }
  async function readResumeFile(file) {
    const name = file.name.toLowerCase();
    if (file.size > 8 * 1024 * 1024) throw new Error("That file is over 8 MB. Attach a smaller PDF or Word file.");
    if (name.endsWith(".doc")) throw new Error("Older Word files (.doc) can't be read. In Word, use Save As and pick .docx or PDF, then attach that.");
    if (name.endsWith(".docx")) {
      await loadScript("vendor/jszip.min.js");
      const zip = await window.JSZip.loadAsync(file);
      const xml = await zip.file("word/document.xml")?.async("string");
      if (!xml) throw new Error("That doesn't look like a Word document. Try exporting it as PDF.");
      return wordXmlToText(xml);
    }
    if (name.endsWith(".pdf")) {
      const pdfjs = await import("./vendor/pdf.min.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.mjs";
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
      const pages = [];
      for (let i = 1; i <= Math.min(doc.numPages, 15); i++) {
        const tc = await (await doc.getPage(i)).getTextContent();
        pages.push(tc.items.map((it) => (it.str || "") + (it.hasEOL ? "\n" : " ")).join(""));
      }
      const text = pages.join("\n").replace(/[ \t]+/g, " ").trim();
      if (text.length < 50) throw new Error("This PDF looks like a scanned image, so its words can't be read. Attach the Word version, or a PDF saved from Word.");
      return text;
    }
    if (name.endsWith(".txt") || file.type === "text/plain") return (await file.text()).trim();
    throw new Error("Attach a PDF, a Word (.docx) or a text file.");
  }
  async function findSkills(text) {
    if (!state.dictionary) state.dictionary = await rpc("app_skill_dictionary");
    const t = " " + text.toLowerCase().replace(/\s+/g, " ") + " ";
    const own = list($("f-skills")?.value || "").map((x) => x.toLowerCase());
    return [...new Set([...state.dictionary, ...own])].filter((k) => k && t.includes(k));
  }
  // Years of work experience from date ranges like "Aug 2024 – Present" or "Jan 2022 - Mar 2023".
  // Year-only ranges (usually education) are ignored; overlapping jobs are counted once.
  function estimateYears(text) {
    const M = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const mon = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
    const re = new RegExp(`${mon}\\s*[’']?(\\d{2,4})\\s*(?:-|–|—|to|till)\\s*(?:(present|current|now|today|date)|${mon}\\s*[’']?(\\d{2,4}))`, "gi");
    const yr = (y) => { const n = Number(y); return n < 100 ? 2000 + n : n; };
    const now = new Date(), nowIdx = now.getFullYear() * 12 + now.getMonth();
    const spans = [];
    for (const m of String(text || "").matchAll(re)) {
      const start = yr(m[2]) * 12 + M[m[1].toLowerCase().slice(0, 3)];
      const end = m[3] ? nowIdx : yr(m[5]) * 12 + M[m[4].toLowerCase().slice(0, 3)];
      if (start >= 1970 * 12 && end >= start && end <= nowIdx + 1) spans.push([start, end]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    let total = 0, cur = null;
    for (const sp of spans) {
      if (!cur || sp[0] > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [...sp]; } else cur[1] = Math.max(cur[1], sp[1]);
    }
    if (cur) total += cur[1] - cur[0];
    return spans.length ? Math.floor(total / 12) : null;
  }
  function showResumeResult(r) {
    const status = $("resume-status"), chips = $("resume-skills"), keep = $("resume-keep");
    if (!r) { status.textContent = ""; chips.replaceChildren(); keep.hidden = true; return; }
    status.textContent = r.skills.length
      ? `Read “${r.name}” on this device. Found ${r.skills.length} skills:`
      : `Read “${r.name}”, but found none of the common skills we look for. You can still save the full text.`;
    const pretty = (k) => k.replace(/negotiat$/, "negotiation").replace(/client servic$/, "client servicing");
    chips.replaceChildren(...r.skills.map((k) => el("span", { class: "chip", text: pretty(k) })));
    const yrs = estimateYears(r.text);
    const field = $("f-years");
    if (yrs != null && field) {
      const same = Number(field.value) === yrs;
      chips.append(el("p", { class: "hint", style: "flex-basis:100%" },
        `Your resume shows about ${yrs} year${yrs === 1 ? "" : "s"} of work experience` + (same ? ", which matches your profile." : `; your profile says ${field.value}. `),
        same ? null : el("button", { class: "linkish", type: "button", "data-act": "use-years", "data-years": yrs, text: `Use ${yrs}` })));
    }
    keep.hidden = false;
    if (!r.skills.length) $("k-full").checked = true;
  }
  async function resumeFromFile(file) {
    const status = $("resume-status");
    showResumeResult(null);
    status.textContent = "Reading your resume on this device…";
    try {
      const text = await readResumeFile(file);
      state.pendingResume = { name: file.name, text, skills: await findSkills(text) };
      showResumeResult(state.pendingResume);
    } catch (e) {
      state.pendingResume = null;
      status.textContent = errText(e);
    }
  }
  let pasteTimer;
  function resumeFromText(text, name) {
    clearTimeout(pasteTimer);
    pasteTimer = setTimeout(async () => {
      if (text.length < 200) { state.pendingResume = null; return showResumeResult(null); }
      state.pendingResume = { name, text, skills: await findSkills(text).catch(() => []) };
      showResumeResult(state.pendingResume);
    }, 400);
  }

  let confirmRemove = false;
  async function saveProfile(ev) {
    ev.preventDefault();
    const err = $("profile-error"); err.textContent = "";
    const btn = $("profile-save");
    const payload = {
      city_names: list($("f-city").value), country_name: $("f-country").value.trim(),
      country_code: $("f-code").value.trim(), timezone: $("f-tz").value.trim(),
      years_experience: Number($("f-years").value || 0),
      role_keywords: list($("f-roles").value), best_fit_keywords: list($("f-best").value),
      exclude_keywords: list($("f-exclude").value), remote_regions: list($("f-regions").value),
      skills: list($("f-skills").value),
    };
    if (!payload.city_names.length) return (err.textContent = "Add your city.");
    if (!payload.role_keywords.length) return (err.textContent = "Add at least one job title you want.");
    if (payload.country_code && !/^[a-z]{2}$/i.test(payload.country_code)) return (err.textContent = "Country code is 2 letters, like IN.");
    if (!payload.remote_regions.length && payload.country_name) payload.remote_regions = [payload.country_name, "anywhere", "worldwide"];
    const useResume = $("r-use").checked;
    const pending = state.pendingResume;
    const had = !!state.settings?.resume_label;
    if (useResume && !pending && !had) return (err.textContent = "Attach your resume, or choose “No resume”.");
    if (!useResume && had && !confirmRemove) {
      confirmRemove = true;
      err.textContent = "This erases your saved resume and turns off fit scores. Tap Save again to confirm.";
      return;
    }
    confirmRemove = false;
    busy(btn, true);
    try {
      const first = !state.settings?.configured;
      state.settings = await rpc("app_save_settings", { p: payload });
      if (useResume && pending) {
        state.settings = $("k-full").checked
          ? await rpc("app_save_resume", { p_label: pending.name, p_text: pending.text })
          : await rpc("app_save_resume_skills", { p_label: pending.name, p_skills: pending.skills });
        state.pendingResume = null;
      } else if (!useResume && had) {
        state.settings = await rpc("app_remove_resume");
      }
      state.me = await rpc("app_me");
      state.home = state.jobs = null;
      toast("Saved");
      if (first) location.hash = "today"; else renderProfile();
    } catch (e) { err.textContent = errText(e); } finally { busy(btn, false); }
  }

  async function addCompany(ev) {
    ev.preventDefault();
    const err = $("company-error"); err.textContent = "";
    const name = $("c-name").value.trim(), url = $("c-url").value.trim();
    if (!name) return (err.textContent = "Enter the company's name.");
    try {
      const r = await rpc("app_add_company", { p_name: name, p_careers_url: url || null, p_sector: $("c-sector").value });
      toast(r.boards_added ? "Following. Its jobs appear after tonight's search." : "Following. Already on the nightly search.");
      $("c-name").value = ""; $("c-url").value = "";
      state.jobs = null;
    } catch (e) { err.textContent = errText(e); }
  }

  // ---------- Morning alerts ----------
  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function keyBytes(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  async function currentSubscription() {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }
  function deviceName() {
    const ua = navigator.userAgent;
    return /iphone|ipad/i.test(ua) ? "iPhone" : /android/i.test(ua) ? "Android" : /mac/i.test(ua) ? "Mac" : /windows/i.test(ua) ? "Windows" : "Computer";
  }
  function alertsPanel(s) {
    const box = el("div", { class: "panel", id: "alerts" }, el("h2", { text: "Morning alerts" }),
      el("p", { text: "Get a notification after 7 am with today's top pick: the company, the role and a line from the job post. Tap it to open the job." }));
    const status = el("p", { class: "hint", id: "alerts-status" });
    const actions = el("div", { class: "actions" });
    box.append(status, actions);
    const say = (t) => (status.textContent = t);
    if (window.Capacitor) {
      say("Alerts don't work inside the Android app yet. Open " + CFG.appUrl + " in Chrome, tap ⋮ → Install app, and turn alerts on there.");
      return box;
    }
    if (isIOS() && !isStandalone()) {
      say("On iPhone, alerts work once Daily Five is on your Home Screen: in Safari tap Share → Add to Home Screen, open it from there, then come back here.");
      return box;
    }
    if (!pushSupported() || location.protocol !== "https:") {
      say("This browser can't receive alerts. Try Chrome, Edge, Firefox or Safari.");
      return box;
    }
    const on = el("button", { class: "btn primary", type: "button", text: "Turn on morning alerts" });
    const test = el("button", { class: "btn", type: "button", text: "Send a test alert" });
    const off = el("button", { class: "btn ghost", type: "button", text: "Turn off on this device" });
    const refresh = async () => {
      const sub = await currentSubscription().catch(() => null);
      const denied = Notification.permission === "denied";
      on.hidden = !!sub; test.hidden = off.hidden = !sub;
      say(denied ? "Notifications are blocked for this site. Allow them in your browser or phone settings, then try again."
        : sub ? `Alerts are on for this ${deviceName()}${s.push_devices > 1 ? ` (and ${s.push_devices - 1} other device${s.push_devices > 2 ? "s" : ""})` : ""}.`
        : "Alerts are off on this device.");
    };
    on.addEventListener("click", () => act(on, async () => {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { await refresh(); throw new Error("Notifications weren't allowed."); }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(CFG.vapidPublicKey) });
      state.settings = await rpc("app_save_push_subscription", { p: sub.toJSON(), p_device: deviceName() });
      s = state.settings; await refresh();
    }, "Alerts are on"));
    test.addEventListener("click", () => act(test, async () => {
      const { data, error } = await sb.functions.invoke("send-alerts", { body: { mode: "test" } });
      if (error) throw error;
      if (!data?.sent) throw new Error(data?.message || "The test alert couldn't be delivered. Try turning alerts off and on again.");
    }, "Test alert sent"));
    off.addEventListener("click", () => act(off, async () => {
      const sub = await currentSubscription();
      if (sub) { await rpc("app_remove_push_subscription", { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
      state.settings = await rpc("app_settings"); s = state.settings; await refresh();
    }, "Alerts off on this device"));
    actions.append(on, test, off);
    refresh();
    return box;
  }

  // ---------- Your data & privacy ----------
  function privacyPanel(s) {
    const resumeLine = !s.resume_label ? "No resume is saved. Your picks come from your job titles only."
      : s.resume_storage === "skills_only" ? "Only the skill words from your resume are saved. The file itself never left your device."
      : "Your resume text is saved privately in your account. You can switch to “skills only” by attaching it again.";
    const box = el("div", { class: "panel", id: "privacy" }, el("h2", { text: "Your data & privacy" }),
      el("ul", { class: "privacy-list" },
        el("li", { text: "Only you can see your profile, resume, picks and applications. Not other members, and not the app's public website." }),
        el("li", { text: resumeLine }),
        el("li", { text: "Resume files are read on your phone or laptop. They're never uploaded or stored as files." }),
        el("li", { text: "Everything travels encrypted (HTTPS), and only invited members can sign in." }),
        el("li", { text: "Job listings come from companies' public careers pages. Nothing about you is shared with them." })));
    if (state.me?.role !== "owner") {
      const erase = el("button", { class: "btn danger", type: "button", text: "Erase my data and leave" });
      const err = el("div", { class: "formerr", role: "alert" });
      erase.addEventListener("click", async () => {
        if (erase.dataset.confirm !== "1") {
          erase.dataset.confirm = "1"; erase.textContent = "Tap again to erase everything";
          err.textContent = "This wipes your resume, settings, notes and alerts, and signs you out. It can't be undone.";
          return;
        }
        busy(erase, true);
        try { await rpc("app_erase_my_data"); await sb.auth.signOut(); toast("Your data has been erased"); showAuth(); }
        catch (e) { err.textContent = errText(e); busy(erase, false); }
      });
      box.append(erase, err);
    }
    return box;
  }

  // ---------- Owner: invites ----------
  function shareText(email, code) {
    return `You're invited to Daily Five, an app that picks five jobs for you every morning.\n\n` +
      `1. Open ${CFG.appUrl}\n` +
      `   iPhone: open it in Safari, tap Share, then "Add to Home Screen"\n` +
      `   Android: install the app from ${CFG.apkUrl}\n` +
      `2. Tap “First time here”\n3. Email: ${email}\n   Choose a password\n   Invite code: ${code}\n\n` +
      `A resume is optional. Without one you'll still see which companies are hiring for your roles.`;
  }
  function renderAdmin() {
    const a = state.admin;
    const box = el("div", { class: "panel", id: "admin" }, el("h2", { text: "Invite people" }),
      el("p", { text: "Only people you invite can use the app. Each invite works once, for one email address." }));
    const form = el("form", { novalidate: true, class: "grid2" },
      field("i-email", "Their email", "", null, { type: "email", placeholder: "friend@example.com" }),
      el("div", { class: "field" }, el("span", { class: "label", text: " " }), el("button", { class: "btn primary", type: "submit", text: "Create invite" })));
    const out = el("div", { id: "invite-out" });
    const ierr = el("div", { class: "formerr", role: "alert" });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault(); ierr.textContent = "";
      try {
        const r = await rpc("app_invite", { p_email: $("i-email").value.trim() });
        const msg = shareText(r.email, r.code);
        const copy = el("button", { class: "btn", type: "button", text: "Copy message" });
        copy.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(msg); toast("Copied. Paste it into WhatsApp or email."); }
          catch { const r2 = document.createRange(); r2.selectNodeContents(pre); getSelection().removeAllRanges(); getSelection().addRange(r2); toast("Selected. Copy it from your keyboard menu."); }
        });
        const pre = el("pre", { class: "share", text: msg });
        out.replaceChildren(el("p", {}, "Code for ", el("b", { text: r.email }), ":"), el("div", { class: "codebox", text: r.code }), pre, copy);
        $("i-email").value = "";
        state.admin = await rpc("app_admin"); fillAdminLists();
      } catch (e) { ierr.textContent = errText(e); }
    });
    box.append(form, ierr, out, el("div", { id: "admin-lists" }));
    setTimeout(fillAdminLists, 0);
    if (!a) rpc("app_admin").then((d) => { state.admin = d; fillAdminLists(); }).catch(() => {});
    return box;
  }
  function fillAdminLists() {
    const host = $("admin-lists"); const a = state.admin;
    if (!host || !a) return;
    const rows = [];
    if (a.invites.length) rows.push(el("h3", { class: "group-h", text: "Waiting to join" }),
      ...a.invites.map((i) => el("div", { class: "row" }, el("span", {}, i.email, el("span", { class: "meta", text: "  code " + i.code })),
        el("button", { class: "btn ghost", type: "button", "data-act": "revoke-invite", "data-id": i.id, text: "Cancel invite" }))));
    rows.push(el("h3", { class: "group-h", text: "Members" }),
      ...a.members.map((m) => el("div", { class: "row" },
        el("span", {}, m.email, el("span", { class: "meta", text: "  " + (m.role === "owner" ? "owner" : m.revoked ? "removed" : m.configured ? "active" : "hasn't set up yet") })),
        m.role !== "owner" && !m.revoked ? el("button", { class: "btn danger", type: "button", "data-act": "remove-member", "data-id": m.user_id, text: "Remove access" }) : null)));
    host.replaceChildren(...rows);
  }

  // ---------- loading & routing ----------
  const loaders = {
    today: async () => { state.home = await rpc("app_home"); try { localStorage.setItem("d5:home", JSON.stringify(state.home)); } catch {} renderToday(); },
    jobs: async () => { if (!state.home) state.home = await rpc("app_home"); state.jobs = await rpc("app_jobs"); renderJobs(); },
    applied: async () => { state.apps = await rpc("app_applications"); renderApplied(); },
    profile: async () => { state.settings = await rpc("app_settings"); renderProfile(); },
  };
  const bodies = { today: "today-body", jobs: "jobs-body", applied: "applied-body", profile: "profile-body" };
  const loaded = { today: () => state.home, jobs: () => state.jobs, applied: () => state.apps, profile: () => state.settings };

  async function load(view, force) {
    if (!force && loaded[view]()) {
      ({ today: renderToday, jobs: renderJobs, applied: renderApplied, profile: renderProfile })[view]();
      return;
    }
    const box = $(bodies[view]);
    if (!box.querySelector(".job, .panel:not(.error), .company")) box.replaceChildren(el("div", { class: "skeleton" }), el("div", { class: "skeleton" }));
    try { await loaders[view](); }
    catch (e) {
      if (/invite to use this app/i.test(e?.message || "")) { state.me = await rpc("app_me").catch(() => null); return showClaim(); }
      box.replaceChildren(errorPanel(e, () => load(view, true)));
    }
  }
  function route() {
    if (!state.me?.member) return;
    let view = location.hash.slice(1);
    const m = /^job-(\d+)$/.exec(view);           // opened from a morning alert
    if (m) { state.focusJob = Number(m[1]); view = "jobs"; }
    if (!VIEWS.includes(view)) view = state.me.configured ? "today" : "profile";
    if (!state.me.configured && view !== "profile") view = "profile";
    state.view = view;
    showOnly("view-" + view);
    for (const v of VIEWS) $("tab-" + v).setAttribute("aria-selected", v === view ? "true" : "false");
    if (view === "jobs" && state.focusJob && !m) state.focusJob = null;
    load(view, view === "today");
  }
  window.addEventListener("hashchange", route);

  // ---------- actions ----------
  function patchJob(u) {
    const merge = (arr) => arr && arr.forEach((x, i) => { if (x.job_id === u.job_id) arr[i] = { ...x, ...u }; });
    merge(state.home?.picks); merge(state.jobs); merge(state.apps);
  }
  const findJob = (id) => [...(state.home?.picks || []), ...(state.jobs || []), ...(state.apps || [])].find((j) => j.job_id === id);
  function rerender() { renderToday(); renderJobs(); renderApplied(); }
  async function act(btn, fn, ok) {
    busy(btn, true);
    try { await fn(); if (ok) toast(ok); }
    catch (e) { toast(errText(e)); }
    finally { busy(btn, false); }
  }
  async function setStatus(jobId, status, note, btn) {
    await act(btn, async () => {
      const u = await rpc("app_set_status", { p_job_id: jobId, p_status: status, p_note: note === undefined ? null : note });
      if (u) patchJob(u);
      state.apps = null;
      if (state.view === "applied") await loaders.applied();
      rerender();
      if (state.home) loaders.today().catch(() => {});
    }, "Marked " + (STATUS_LABEL[status] || status).toLowerCase());
  }

  document.addEventListener("click", async (ev) => {
    const t = ev.target.closest("[data-act], .tab, #job-filter button, #jobs-mode button");
    if (!t) return;
    if (t.classList.contains("tab")) { location.hash = t.dataset.view; return; }
    if (t.closest("#job-filter")) {
      state.filter = t.dataset.f;
      for (const b of document.querySelectorAll("#job-filter button")) b.setAttribute("aria-pressed", b === t ? "true" : "false");
      return renderJobs();
    }
    if (t.closest("#jobs-mode")) {
      state.jobsMode = t.dataset.m;
      for (const b of document.querySelectorAll("#jobs-mode button")) b.setAttribute("aria-pressed", b === t ? "true" : "false");
      return renderJobs();
    }
    const row = t.closest("[data-job]"); const jobId = row ? Number(row.dataset.job) : null;
    switch (t.dataset.act) {
      case "status": {
        const j = findJob(jobId);
        if (j && j.status === t.dataset.status) return toast("Already " + STATUS_LABEL[j.status].toLowerCase() + ". Change it under My applications.");
        return setStatus(jobId, t.dataset.status, undefined, t);
      }
      case "skip":
        return act(t, async () => {
          await rpc("app_dismiss_pick", { p_pick_id: Number(t.dataset.pick) });
          const p = state.home.picks.find((x) => x.pick_id === Number(t.dataset.pick)); if (p) p.dismissed = true;
          renderToday();
        }, "Skipped");
      case "fav":
        return act(t, async () => {
          const fav = await rpc("app_toggle_favourite", { p_company_id: Number(t.dataset.company) });
          for (const arr of [state.home?.picks, state.jobs, state.apps]) (arr || []).forEach((x) => { if (x.company_id === Number(t.dataset.company)) x.favourite = !!fav; });
          rerender();
        }, null);
      case "save-note": {
        const j = findJob(jobId);
        return setStatus(jobId, j?.status || "saved", $("note-" + jobId).value, t);
      }
      case "info":
        return openJobDetails(jobId, t);
      case "close-dialog": {
        const dlg = $("job-dialog"); if (dlg.close) dlg.close(); else dlg.removeAttribute("open");
        return;
      }
      case "show-senior":
        state.showSenior = !state.showSenior;
        return renderJobs();
      case "use-years":
        $("f-years").value = t.dataset.years; t.closest(".hint").textContent = "Updated. Tap Save to keep it.";
        return;
      case "sector":
        state.sector = t.dataset.sector;
        return renderJobs();
      case "unfocus":
        state.focusJob = null; history.replaceState(null, "", "#jobs");
        return renderJobs();
      case "open-company":
        state.jobsMode = "jobs"; state.q = t.dataset.name; $("job-search").value = t.dataset.name;
        for (const b of document.querySelectorAll("#jobs-mode button")) b.setAttribute("aria-pressed", b.dataset.m === "jobs" ? "true" : "false");
        return renderJobs();
      case "revoke-invite":
        return act(t, async () => { await rpc("app_revoke_invite", { p_invite_id: Number(t.dataset.id) }); state.admin = await rpc("app_admin"); fillAdminLists(); }, "Invite cancelled");
      case "remove-member":
        if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Tap again to remove"; return; }
        return act(t, async () => { await rpc("app_remove_member", { p_user_id: t.dataset.id }); state.admin = await rpc("app_admin"); fillAdminLists(); }, "Access removed");
    }
  });
  document.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.dataset && t.dataset.act === "select-status") setStatus(Number(t.closest("[data-job]").dataset.job), t.value, undefined, t);
  });
  $("job-search").addEventListener("input", (ev) => { state.q = ev.target.value; renderJobs(); });
  $("job-dialog").addEventListener("click", (ev) => { if (ev.target.id === "job-dialog" && ev.target.close) ev.target.close(); });

  sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") showAuth(); });

  // Show the last saved Today screen instantly while fresh data loads
  try {
    const cached = JSON.parse(localStorage.getItem("d5:home") || "null");
    if (cached && cached.picks) state.home = cached;
  } catch {}

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  boot().catch((e) => showAuth(errText(e)));
})();

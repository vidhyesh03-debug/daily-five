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
  const state = { me: null, home: null, jobs: null, apps: null, settings: null, admin: null,
                  filter: "all", q: "", jobsMode: "jobs", view: null };

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
    if (j.years_required != null) chips.append(el("span", { class: "chip", text: "Asks " + j.years_required + "+ yrs" }));
    if (j.status) chips.append(el("span", { class: "chip status " + j.status, text: STATUS_LABEL[j.status] || j.status }));
    if (j.first_seen) chips.append(el("span", { class: "chip", text: "Found " + fmtDate(j.first_seen, { day: "numeric", month: "short" }) }));

    const body = el("div", { class: "body" }, chips);
    if (j.score != null && j.summary) body.append(el("p", { class: "summary", text: j.summary }));
    const plus = j.score != null ? bullets(j.strengths, "Works for you") : null;
    const minus = j.score != null ? bullets(j.gaps, "Watch out for") : null;
    if (plus || minus) body.append(el("details", {}, el("summary", { text: "Why this score" }),
      el("div", { class: "why" }, plus, minus),
      el("p", { class: "by", text: "Scored with simple rules: job title, years asked for, location, and skills from your resume and profile." })));

    const actions = el("div", { class: "actions" });
    const url = safeUrl(j.url);
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
    if (q && !(j.company + " " + j.title).toLowerCase().includes(q)) return false;
    return true;
  }
  function renderJobs() {
    if (!state.jobs) return;
    $("n-jobs").textContent = String(state.jobs.length);
    $("f-city-btn").textContent = state.home?.city || "My city";
    const rows = state.jobs.filter(jobMatches);
    const box = $("jobs-body");
    if (state.jobsMode === "companies") {
      box.classList.remove("grid");
      const by = new Map();
      for (const j of rows) {
        const c = by.get(j.company_id) || { id: j.company_id, name: j.company, fav: j.favourite, n: 0, newest: j.first_seen, industry: j.industry };
        c.n++; if (j.first_seen > c.newest) c.newest = j.first_seen; by.set(j.company_id, c);
      }
      const cos = [...by.values()].sort((a, b) => (b.fav - a.fav) || (b.n - a.n) || a.name.localeCompare(b.name));
      box.replaceChildren(...(cos.length ? cos.map((c) => el("button", { class: "company", type: "button", "data-act": "open-company", "data-name": c.name },
        el("span", {}, el("b", { text: (c.fav ? "★ " : "") + c.name }), c.industry ? el("span", { class: "hint", text: " · " + c.industry }) : null,
          el("div", { class: "hint", text: "Newest role found " + fmtDate(c.newest, { day: "numeric", month: "short" }) })),
        el("span", { class: "count", text: c.n + (c.n === 1 ? " role" : " roles") }))) : [el("p", { class: "empty", text: "No companies match this filter." })]));
      return;
    }
    box.classList.add("grid");
    box.replaceChildren(...(rows.length ? rows.map((j) => jobRow(j)) : [el("p", { class: "empty", text: "No jobs match this filter." })]));
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

    // resume choice
    const useResume = el("input", { type: "radio", name: "resume-mode", id: "r-use", value: "use", checked: hasResume || undefined });
    const noResume = el("input", { type: "radio", name: "resume-mode", id: "r-none", value: "none", checked: !hasResume || undefined });
    const resumeBox = el("div", { id: "resume-box", class: "field" },
      el("label", { for: "f-resume", text: hasResume ? "Your resume text (" + s.resume_label + ")" : "Paste your resume text" }),
      el("textarea", { id: "f-resume", rows: 8, placeholder: "Open your resume, select all, copy, and paste here." }),
      el("div", { class: "hint", text: "Stored only in your account. Only you can see it. Removing it erases the text." }));
    resumeBox.querySelector("textarea").value = hasResume ? (s.resume_text || "") : "";
    resumeBox.hidden = !hasResume;
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
      const addForm = el("form", { class: "panel", id: "company-form", novalidate: true },
        el("h2", { text: "Follow a company" }),
        el("p", { text: "Works for companies that post jobs on Greenhouse, Lever or Ashby. Paste their careers link if you have it. New companies are checked overnight." }),
        el("div", { class: "grid2" }, field("c-name", "Company name", "", null, { placeholder: "Acme" }), field("c-url", "Careers link (optional)", "", null, { placeholder: "https://jobs.lever.co/acme", type: "url" })),
        el("div", { class: "formerr", id: "company-error", role: "alert" }),
        el("div", { class: "actions" }, el("button", { class: "btn", type: "submit", text: "Follow" })),
        el("p", { class: "hint", text: `Searching ${s.boards_active ?? "–"} company job boards nightly${s.boards_pending ? `, ${s.boards_pending} waiting for their first check` : ""}.` }));
      addForm.addEventListener("submit", addCompany);
      kids.push(addForm);
    }
    if (state.me?.role === "owner" && !first) kids.push(renderAdmin());
    $("profile-body").replaceChildren(...kids);
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
    const text = $("f-resume").value.trim();
    const had = !!state.settings?.resume_label;
    if (useResume && text && text.length < 200) return (err.textContent = "That resume looks too short. Paste the whole thing.");
    if (useResume && !text && !had) return (err.textContent = "Paste your resume, or choose “No resume”.");
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
      if (useResume && text && text !== (state.settings.resume_text || "")) {
        state.settings = await rpc("app_save_resume", { p_label: "Resume " + new Date().toLocaleDateString("en-IN"), p_text: text });
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
      const r = await rpc("app_add_company", { p_name: name, p_careers_url: url || null });
      toast(r.boards_added ? "Following. Its jobs appear after tonight's search." : "Following. Already on the nightly search.");
      $("c-name").value = ""; $("c-url").value = "";
      state.jobs = null;
    } catch (e) { err.textContent = errText(e); }
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
    if (!VIEWS.includes(view)) view = state.me.configured ? "today" : "profile";
    if (!state.me.configured && view !== "profile") view = "profile";
    state.view = view;
    showOnly("view-" + view);
    for (const v of VIEWS) $("tab-" + v).setAttribute("aria-selected", v === view ? "true" : "false");
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

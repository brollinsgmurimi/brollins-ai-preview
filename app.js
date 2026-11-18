(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const API_KEY = "brollins_api_url", TOKEN_KEY = "brollins_session_token", USER_KEY = "brollins_session_user";
  let apiBase = (localStorage.getItem(API_KEY) || "").replace(/\/+$/, "");
  let token = sessionStorage.getItem(TOKEN_KEY) || "", user = null, conversations = [], activeId = null, busy = false;
  const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const welcome = '<div class="welcome"><div class="orb">✦</div><div class="eyebrow">WELCOME TO BRO-LLINS AI</div><h2>What would you like to<br><em>work on today?</em></h2><p>Your ideas, research and projects — organised in one workspace.</p></div>';
  const setStatus = (s, ok) => { $("connectionStatus").textContent = s; $("connectionStatus").style.color = ok ? "#65d5a3" : "#e8c17d"; };
  async function api(path, opts) {
    opts = opts || {};
    if (!apiBase) throw new Error("Enter your deployed API URL first.");
    const headers = {"Content-Type":"application/json"};
    if (opts.authenticated !== false && token) headers.Authorization = "Bearer " + token;
    const response = await fetch(apiBase + path, {method:opts.method || "GET", headers, body:opts.body ? JSON.stringify(opts.body) : undefined});
    let data = {}; try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      if (response.status === 401 && opts.authenticated !== false) { clearSession(); authView("login", "Your session expired. Please sign in again."); }
      throw new Error(data.error && data.error.message ? data.error.message : "Request failed (" + response.status + ").");
    }
    return data;
  }
  function clearSession() {
    token = ""; user = null; conversations = []; activeId = null;
    sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY);
    updateIdentity(); renderChatList(); $("messages").innerHTML = welcome;
  }
  function updateIdentity() {
    $("identity").textContent = user ? user.display_name + " · " + user.role : "Not signed in";
    $("signOut").classList.toggle("hidden", !user); $("newChat").disabled = !user;
  }
  function authView(mode, message) {
    mode = mode || "login";
    const titles = {login:"Welcome back",register:"Join Bro-llins AI",bootstrap:"Create the owner account"};
    const descriptions = {login:"Sign in to your private workspace.",register:"Use a one-time invitation from the owner.",bootstrap:"One-time setup for the first owner account."};
    $("authTitle").textContent = titles[mode]; $("authDescription").textContent = descriptions[mode]; $("authMessage").textContent = message || "";
    let fields = "";
    if (mode !== "login") fields += '<label>Display name</label><input id="authName" autocomplete="name" maxlength="80" required placeholder="Your name">';
    fields += '<label>Email address</label><input id="authEmail" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com">';
    fields += '<label>Password</label><input id="authPassword" type="password" minlength="12" maxlength="128" required placeholder="At least 12 characters">';
    if (mode === "register") fields += '<label>Invitation code</label><input id="authInvite" required placeholder="Paste your invitation">';
    if (mode === "bootstrap") fields += '<label>One-time owner setup secret</label><input id="authSecret" type="password" required placeholder="Server setup secret">';
    fields += '<button class="primary" id="authSubmit" type="submit">' + (mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Create owner account") + '</button>';
    $("authFields").innerHTML = fields;
    $("authForm").onsubmit = async (event) => {
      event.preventDefault(); const button = $("authSubmit"); button.disabled = true; button.textContent = "Please wait…";
      try {
        const payload = {email:$("authEmail").value.trim(),password:$("authPassword").value};
        if ($("authName")) payload.display_name = $("authName").value.trim();
        if (mode === "register") payload.invitation = $("authInvite").value.trim();
        if (mode === "bootstrap") payload.bootstrap_secret = $("authSecret").value;
        const path = mode === "login" ? "/api/auth/login" : mode === "register" ? "/api/auth/register" : "/api/auth/bootstrap";
        const result = await api(path,{method:"POST",body:payload,authenticated:false});
        token = result.token; user = result.user;
        sessionStorage.setItem(TOKEN_KEY,token); sessionStorage.setItem(USER_KEY,JSON.stringify(user));
        $("authGate").classList.add("hidden"); updateIdentity(); await loadConversations();
        setStatus("Connected · private account",true); $("modePill").textContent = "● Connected";
      } catch (error) { $("authMessage").textContent = error.message; }
      finally { if ($("authSubmit")) $("authSubmit").disabled = false; }
    };
    $("authGate").classList.remove("hidden");
  }
  async function checkApi() {
    apiBase = $("apiUrl").value.trim().replace(/\/+$/,""); localStorage.setItem(API_KEY,apiBase);
    $("settingsApiUrl").value = apiBase;
    try {
      const health = await api("/api/health",{authenticated:false});
      setStatus(health.ai_configured ? "API online · AI binding detected" : "API online · AI not configured",true);
      $("authMessage").textContent = "API connection successful. You can sign in.";
      return true;
    } catch (error) { setStatus(error.message,false); $("authMessage").textContent = error.message; return false; }
  }
  function renderChatList() {
    $("chatList").innerHTML = conversations.map((c) => '<button class="chatitem ' + (c.id === activeId ? "active" : "") + '" data-id="' + esc(c.id) + '">' + esc(c.title) + '</button>').join("") || "<small>No saved conversations yet.</small>";
  }
  function addBubble(role, content) {
    const box = document.createElement("div"), label = document.createElement("b"), text = document.createElement("div");
    box.className = "bubble " + role; label.textContent = role === "user" ? "YOU" : "BRO-LLINS AI";
    text.textContent = content; box.append(label,text); $("messages").appendChild(box); return box;
  }
  async function loadMessages(id) {
    const result = await api("/api/conversations/" + id + "/messages");
    $("messages").innerHTML = "";
    if (!(result.messages || []).length) $("messages").innerHTML = welcome;
    else result.messages.forEach((m) => addBubble(m.role,m.content));
    $("messages").scrollTop = $("messages").scrollHeight; renderChatList();
  }
  async function loadConversations() {
    const result = await api("/api/conversations"); conversations = result.conversations || [];
    activeId = conversations.length ? conversations[0].id : null; renderChatList();
    if (activeId) await loadMessages(activeId); else $("messages").innerHTML = welcome;
  }
  async function fresh() {
    if (!user) return authView("login");
    const result = await api("/api/conversations",{method:"POST",body:{title:"New conversation"}});
    conversations.unshift(result.conversation); activeId = result.conversation.id;
    renderChatList(); $("messages").innerHTML = welcome; $("prompt").focus();
  }
  async function send(text) {
    if (busy || !user || !text.trim()) return;
    if (!activeId) await fresh();
    busy = true; $("sendButton").disabled = true;
    const w = $("messages").querySelector(".welcome"); if (w) w.remove();
    addBubble("user",text); const thinking = addBubble("assistant","Thinking…");
    try {
      const result = await api("/api/conversations/" + activeId + "/messages",{method:"POST",body:{content:text}});
      thinking.remove(); addBubble("assistant",result.assistant_message.content);
      const current = conversations.find((c) => c.id === activeId);
      if (current && current.title === "New conversation") {
        current.title = text.slice(0,42);
        await api("/api/conversations/" + activeId,{method:"PATCH",body:{title:current.title}});
      }
      const i = conversations.findIndex((c) => c.id === activeId);
      if (i > 0) conversations.unshift(conversations.splice(i,1)[0]);
      renderChatList();
    } catch (error) { thinking.remove(); addBubble("assistant","NOTICE: " + error.message); }
    finally { busy = false; $("sendButton").disabled = false; $("messages").scrollTop = $("messages").scrollHeight; }
  }
  function installUI() {
    const style = document.createElement("style");
    style.textContent = ".auth-gate{position:fixed;inset:0;z-index:9999;background:rgba(5,10,20,.94);display:grid;place-items:center;padding:18px}.auth-card{width:min(460px,100%);background:#141f33;border:1px solid #344762;border-radius:16px;padding:26px;box-shadow:0 24px 80px #0009}.auth-card h2{margin:0 0 6px;font-size:25px}.auth-card p{color:#9aaac3}.auth-card label,.settings-api label{display:block;color:#e8c17d;font-size:11px;margin:12px 0 5px}.auth-card input,.settings-api input{width:100%;background:#0e192b;border:1px solid #344762;border-radius:8px;color:#fff;padding:12px;font:inherit}.auth-card button{margin-top:14px}.auth-links,.inline-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.auth-links button,.settings-api button{background:#24334d;border:1px solid #344762;color:#dce6f5;border-radius:8px;padding:9px 12px;cursor:pointer}.auth-message{color:#e8c17d;min-height:22px;font-size:13px;white-space:pre-wrap}.settings-api{background:#141f33;border:1px solid #2a3a56;border-radius:12px;padding:18px;margin-bottom:14px}.settings-api h3{margin:0 0 8px}.settings-api p{color:#9aaac3}.identity-line{font-size:12px;color:#9aaac3;margin:0 0 12px}button:disabled{opacity:.55;cursor:not-allowed}";
    document.head.appendChild(style);
    const gate = document.createElement("div"); gate.id = "authGate"; gate.className = "auth-gate";
    gate.innerHTML = '<div class="auth-card"><div class="orb">✦</div><div class="eyebrow">PRIVATE WORKSPACE</div><h2 id="authTitle">Welcome back</h2><p id="authDescription">Sign in to your private workspace.</p><div class="identity-line">Bro-llins AI · Secure account access</div><form id="authForm"><div id="authFields"></div></form><div id="authMessage" class="auth-message"></div><div class="auth-links"><button type="button" id="showRegister">Use invitation</button><button type="button" id="showBootstrap">First-time owner setup</button><button type="button" id="showLogin">Sign in</button></div><hr style="border-color:#2a3a56;margin:18px 0"><label for="apiUrl">Backend API address</label><input id="apiUrl" type="url" placeholder="https://your-worker.workers.dev"><div class="auth-links"><button type="button" id="apiSave">Save and test API</button></div></div>';
    document.body.appendChild(gate);
    const card = document.createElement("article"); card.className = "settings-api";
    card.innerHTML = '<h3>Private account and API</h3><p id="connectionStatus">Backend not connected</p><div class="identity-line" id="identity">Not signed in</div><label for="settingsApiUrl">Backend API address</label><input id="settingsApiUrl" type="url" placeholder="https://your-worker.workers.dev"><div class="inline-actions"><button id="settingsApiSave" type="button">Save and test connection</button><button id="createInvite" type="button">Create invitation</button><button id="signOut" type="button">Sign out</button></div><p id="inviteResult" class="auth-message"></p><p>Invitations are single-use. Only the owner can create them.</p>';
    $("settingsPage").insertBefore(card,$("settingsPage").firstChild);
    $("apiUrl").value = apiBase; $("settingsApiUrl").value = apiBase;
    $("apiSave").onclick = async () => { const ok = await checkApi(); if (ok && token) await loadConversations().catch((e) => setStatus(e.message,false)); };
    $("settingsApiSave").onclick = async () => { $("apiUrl").value = $("settingsApiUrl").value; const ok = await checkApi(); if (ok && token) await loadConversations().catch((e) => setStatus(e.message,false)); };
    $("showRegister").onclick = () => authView("register");
    $("showBootstrap").onclick = () => authView("bootstrap");
    $("showLogin").onclick = () => authView("login");
    $("signOut").onclick = async () => { try { await api("/api/auth/logout",{method:"POST"}); } catch (_) {} clearSession(); authView("login","You have signed out."); };
    $("createInvite").onclick = async () => {
      try { const r = await api("/api/auth/invitations",{method:"POST",body:{expires_in_seconds:604800}}); $("inviteResult").textContent = "Copy this one-time invitation and share it privately: " + r.invitation; }
      catch (e) { $("inviteResult").textContent = e.message; }
    };
    $("newChat").onclick = () => fresh().catch((e) => setStatus(e.message,false));
    $("chatForm").onsubmit = (e) => { e.preventDefault(); const v = $("prompt").value.trim(); if (v) { $("prompt").value = ""; send(v); } };
    $("sendButton").id = "sendButton";
    $("chatList").onclick = async (e) => { const b = e.target.closest("[data-id]"); if (b) { activeId = b.dataset.id; await loadMessages(activeId).catch((x) => setStatus(x.message,false)); } };
    document.querySelectorAll("[data-prompt]").forEach((b) => b.replaceWith(b.cloneNode(true)));
    document.querySelectorAll("[data-prompt]").forEach((b) => b.addEventListener("click",() => send(b.dataset.prompt)));
    $("backup").onclick = () => alert("Cloud backup export will be added in a later milestone.");
    $("reset").onclick = () => { if (confirm("Sign out of this device? Your cloud account and saved conversations will not be deleted.")) { clearSession(); authView("login"); } };
  }
  async function start() {
    installUI();
    const pill = document.querySelector(".top .pill");
    if (pill) { pill.id = "modePill"; pill.textContent = "● Private workspace"; }
    const footer = document.querySelector(".composerfoot span");
    if (footer) footer.textContent = "Private account · Conversations saved securely";
    updateIdentity();
    if (!apiBase) { setStatus("Backend API address required",false); authView("login","Enter your deployed backend address, then choose Save and test API."); return; }
    try {
      const health = await api("/api/health",{authenticated:false});
      setStatus(health.ai_configured ? "API online · AI binding detected" : "API online · AI not configured",true);
      if (token) {
        try {
          const result = await api("/api/me"); user = result.user; updateIdentity();
          $("authGate").classList.add("hidden"); await loadConversations();
          if (pill) pill.textContent = "● Connected";
        } catch (_) { clearSession(); authView("login","Please sign in to continue."); }
      } else authView("login");
    } catch (error) { authView("login",error.message + " Check the API address below."); }
  }
  start().catch((e) => { console.error(e); authView("login","Workspace initialization failed: " + e.message); });
})();
const MODEL = "@cf/zai-org/glm-4.7-flash";
const SESSION_TTL = 604800;
const PASSWORD_ITERATIONS = 210000;
const MAX_MESSAGE_CHARS = 8000;
const MAX_CONTEXT_MESSAGES = 12;
const DAILY_MESSAGE_LIMIT = 30;

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const now = () => Math.floor(Date.now() / 1000);
const random = (n = 32) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
const hex = (a) => [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (s) => new Uint8Array((s.match(/.{1,2}/g) || []).map((x) => parseInt(x, 16)));
const hash = async (s) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
const token = () => btoa(String.fromCharCode(...random())).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

function cors(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (origin && !allowed.includes(origin)) throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "This website is not allowed to use the API.");
  return {
    "Access-Control-Allow-Origin": origin || allowed[0] || "",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY"
  };
}
async function body(request) {
  const size = Number(request.headers.get("Content-Length") || 0);
  if (size > 20000) throw new HttpError(413, "BODY_TOO_LARGE", "Request is too large.");
  try { return await request.json(); } catch { throw new HttpError(400, "INVALID_JSON", "Send valid JSON."); }
}
function email(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new HttpError(400, "INVALID_EMAIL", "Enter a valid email address.");
  return v;
}
function password(value) {
  const v = String(value || "");
  if (v.length < 12 || v.length > 128) throw new HttpError(400, "INVALID_PASSWORD", "Password must be 12–128 characters.");
  return v;
}
async function passwordHash(value, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(value), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromHex(salt), iterations: PASSWORD_ITERATIONS, hash: "SHA-256" }, key, 256);
  return hex(new Uint8Array(bits));
}
async function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function limit(db, key, max, seconds) {
  const t = now();
  const row = await db.prepare(
    "INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) " +
    "ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END, " +
    "reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING count"
  ).bind(key, t + seconds, t, t).first();
  if (!row || row.count > max) throw new HttpError(429, "RATE_LIMITED", "Too many requests. Please wait and try again.");
}
const ip = (r) => r.headers.get("CF-Connecting-IP") || "unknown";
async function session(db, userId) {
  const value = token();
  await db.prepare("INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)")
    .bind(hex(random(16)), userId, await hash(value), now() + SESSION_TTL, now()).run();
  return { token: value, expires_in: SESSION_TTL };
}
async function auth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const value = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!value || value.length > 200) throw new HttpError(401, "UNAUTHENTICATED", "Please sign in.");
  const user = await env.DB.prepare(
    "SELECT u.id,u.email,u.display_name,u.role FROM sessions s JOIN users u ON u.id=s.user_id " +
    "WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'"
  ).bind(await hash(value), now()).first();
  if (!user) throw new HttpError(401, "SESSION_EXPIRED", "Please sign in again.");
  return { ...user, tokenHash: await hash(value) };
}
const safeUser = (u) => ({ id: u.id, email: u.email, display_name: u.display_name, role: u.role });

async function bootstrap(request, env) {
  await limit(env.DB, "bootstrap:" + ip(request), 5, 3600);
  if (!env.BOOTSTRAP_SECRET) throw new HttpError(503, "BOOTSTRAP_NOT_CONFIGURED", "Owner setup is not configured.");
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
  if (count.n) throw new HttpError(409, "BOOTSTRAP_CLOSED", "The owner account already exists.");
  const b = await body(request);
  if (b.bootstrap_secret !== env.BOOTSTRAP_SECRET) throw new HttpError(403, "INVALID_BOOTSTRAP_SECRET", "Owner setup could not be authorized.");
  const e = email(b.email), p = password(b.password), name = String(b.display_name || "Owner").trim().slice(0, 80) || "Owner";
  const id = hex(random(16)), salt = hex(random(16)), digest = await passwordHash(p, salt);
  await env.DB.prepare("INSERT INTO users(id,email,display_name,password_salt,password_hash,role,status,created_at) VALUES(?,?,?,?,?,'admin','active',?)")
    .bind(id, e, name, salt, digest, now()).run();
  return json({ user: { id, email: e, display_name: name, role: "admin" }, ...await session(env.DB, id) }, 201);
}
async function register(request, env) {
  await limit(env.DB, "register:" + ip(request), 8, 3600);
  const b = await body(request), invitation = await hash(String(b.invitation || ""));
  const invite = await env.DB.prepare("SELECT id,expires_at FROM invitations WHERE token_hash=? AND used_at IS NULL").bind(invitation).first();
  if (!invite || invite.expires_at <= now()) throw new HttpError(403, "INVITATION_INVALID", "Invitation is invalid or expired.");
  const e = email(b.email), p = password(b.password), name = String(b.display_name || "").trim().slice(0, 80);
  if (!name) throw new HttpError(400, "INVALID_NAME", "Enter a display name.");
  const id = hex(random(16)), salt = hex(random(16)), digest = await passwordHash(p, salt);
  let results;
  try {
    const time = now();
    results = await env.DB.batch([
      env.DB.prepare("INSERT INTO users(id,email,display_name,password_salt,password_hash,role,status,created_at) SELECT ?,?,?,?,?, 'member','active',? WHERE EXISTS (SELECT 1 FROM invitations WHERE id=? AND used_at IS NULL AND expires_at>?)").bind(id,e,name,salt,digest,time,invite.id,time),
      env.DB.prepare("UPDATE invitations SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?").bind(time,invite.id,time)
    ]);
  } catch { throw new HttpError(409, "REGISTRATION_CONFLICT", "Email is already registered or invitation has been used."); }
  if (!results || !results[0] || !results[0].meta || results[0].meta.changes !== 1) {
    throw new HttpError(403, "INVITATION_INVALID", "This invitation has already been used or expired.");
  }
  return json({ user: { id, email: e, display_name: name, role: "member" }, ...await session(env.DB, id) }, 201);
}
async function login(request, env) {
  await limit(env.DB, "login:" + ip(request), 10, 900);
  const b = await body(request), e = email(b.email), p = String(b.password || "");
  const u = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(e).first();
  if (!u || u.status !== "active" || p.length > 128 || !(await equal(await passwordHash(p, u.password_salt), u.password_hash))) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  }
  return json({ user: safeUser(u), ...await session(env.DB, u.id) });
}
async function invitations(request, env, user) {
  if (user.role !== "admin") throw new HttpError(403, "FORBIDDEN", "Only the owner can invite users.");
  const value = token(), b = await body(request);
  const expires = now() + Math.min(Math.max(Number(b.expires_in_seconds) || 604800, 3600), 2592000);
  await env.DB.prepare("INSERT INTO invitations(id,token_hash,role,created_by,expires_at,created_at) VALUES(?,?,'member',?,?,?)")
    .bind(hex(random(16)), await hash(value), user.id, expires, now()).run();
  return json({ invitation: value, expires_at: expires }, 201);
}
async function conversations(request, env, user, path) {
  if (path === "/api/conversations" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id,title,created_at,updated_at FROM conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT 100").bind(user.id).all();
    return json({ conversations: rows.results || [] });
  }
  if (path === "/api/conversations" && request.method === "POST") {
    const b = await body(request), title = String(b.title || "New conversation").trim().slice(0,120) || "New conversation";
    const id = hex(random(16)), t = now();
    await env.DB.prepare("INSERT INTO conversations(id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)").bind(id,user.id,title,t,t).run();
    return json({ conversation: { id,title,created_at:t,updated_at:t } },201);
  }
  const m = path.match(/^\/api\/conversations\/([a-f0-9]{32})(?:\/messages)?$/);
  if (!m) throw new HttpError(404,"NOT_FOUND","Endpoint not found.");
  const id = m[1], isMessages = path.endsWith("/messages");
  const conv = await env.DB.prepare("SELECT id FROM conversations WHERE id=? AND user_id=?").bind(id,user.id).first();
  if (!conv) throw new HttpError(404,"CONVERSATION_NOT_FOUND","Conversation not found.");
  if (request.method === "PATCH" && !isMessages) {
    const b=await body(request), title=String(b.title||"").trim().slice(0,120);
    if(!title) throw new HttpError(400,"INVALID_TITLE","Enter a title.");
    await env.DB.prepare("UPDATE conversations SET title=?,updated_at=? WHERE id=? AND user_id=?").bind(title,now(),id,user.id).run();
    return json({ok:true});
  }
  if (request.method === "DELETE" && !isMessages) {
    await env.DB.prepare("DELETE FROM conversations WHERE id=? AND user_id=?").bind(id,user.id).run();
    return json({ok:true});
  }
  if (request.method === "GET" && isMessages) {
    const rows=await env.DB.prepare("SELECT id,role,content,created_at FROM messages WHERE conversation_id=? AND user_id=? ORDER BY created_at ASC LIMIT 500").bind(id,user.id).all();
    return json({messages:rows.results||[]});
  }
  if (request.method === "POST" && isMessages) {
    const b=await body(request), prompt=String(b.content||"").trim();
    if(!prompt||prompt.length>MAX_MESSAGE_CHARS) throw new HttpError(400,"INVALID_MESSAGE","Message is empty or too long.");
    const used=await env.DB.prepare("SELECT count FROM daily_usage WHERE user_id=? AND day=date('now')").bind(user.id).first();
    if((used?.count||0)>=DAILY_MESSAGE_LIMIT) throw new HttpError(429,"APP_DAILY_LIMIT","Your daily message allowance has been reached. Try again tomorrow.");
    if(!env.AI) throw new HttpError(503,"AI_NOT_CONFIGURED","AI is not configured. No paid provider will be used.");
    const userMessageId=hex(random(16)), t=now();
    await env.DB.prepare("INSERT INTO messages(id,conversation_id,user_id,role,content,created_at) VALUES(?,?,?,'user',?,?)").bind(userMessageId,id,user.id,prompt,t).run();
    const rows=await env.DB.prepare("SELECT role,content FROM messages WHERE conversation_id=? AND user_id=? ORDER BY created_at DESC LIMIT ?").bind(id,user.id,MAX_CONTEXT_MESSAGES).all();
    let answer;
    try {
      const out=await env.AI.run(MODEL,{messages:(rows.results||[]).reverse(),max_tokens:700,temperature:0.5});
      answer=typeof out?.response==="string"?out.response.trim():"";
      if(!answer) throw new Error("Empty model response");
    } catch(err) {
      const detail=String(err?.message||err);
      if(/3036|5035|daily free allocation|neurons|quota|free allocation/i.test(detail)) throw new HttpError(429,"FREE_AI_QUOTA_EXHAUSTED","The free AI allowance is exhausted. No paid fallback was attempted. Try again after the allowance resets.");
      if(/3040|capacity|busy/i.test(detail)) throw new HttpError(503,"AI_CAPACITY_UNAVAILABLE","The free AI service is temporarily busy.");
      console.error("Workers AI error",detail.slice(0,200));
      throw new HttpError(503,"AI_UNAVAILABLE","The free AI service is unavailable. No paid fallback was attempted.");
    }
    const assistantId=hex(random(16));
    await env.DB.batch([
      env.DB.prepare("INSERT INTO messages(id,conversation_id,user_id,role,content,created_at) VALUES(?,?,?,'assistant',?,?)").bind(assistantId,id,user.id,answer,now()),
      env.DB.prepare("INSERT INTO daily_usage(user_id,day,count) VALUES(?,date('now'),1) ON CONFLICT(user_id,day) DO UPDATE SET count=count+1").bind(user.id),
      env.DB.prepare("UPDATE conversations SET updated_at=? WHERE id=? AND user_id=?").bind(now(),id,user.id)
    ]);
    return json({user_message:{id:userMessageId,role:"user",content:prompt,created_at:t},assistant_message:{id:assistantId,role:"assistant",content:answer,created_at:now()},model:MODEL},201);
  }
  throw new HttpError(405,"METHOD_NOT_ALLOWED","Method not allowed.");
}
async function route(request, env) {
  const path=new URL(request.url).pathname;
  if(request.method==="GET"&&path==="/api/health") return json({ok:true,service:"bro-llins-ai-api",ai_configured:Boolean(env.AI),model:MODEL});
  if(request.method==="POST"&&path==="/api/auth/bootstrap") return bootstrap(request,env);
  if(request.method==="POST"&&path==="/api/auth/register") return register(request,env);
  if(request.method==="POST"&&path==="/api/auth/login") return login(request,env);
  const user=await auth(request,env);
  if(request.method==="GET"&&path==="/api/me") return json({user:safeUser(user)});
  if(request.method==="POST"&&path==="/api/auth/logout") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(user.tokenHash).run();
    return json({ok:true});
  }
  if(request.method==="POST"&&path==="/api/auth/invitations") return invitations(request,env,user);
  if(path==="/api/conversations"||path.startsWith("/api/conversations/")) return conversations(request,env,user,path);
  throw new HttpError(404,"NOT_FOUND","Endpoint not found.");
}
export default {
  async fetch(request,env) {
    let headers;
    try { headers=cors(request,env); }
    catch(e) { return json({error:{code:e.code,message:e.message}},e.status); }
    if(request.method==="OPTIONS") return new Response(null,{status:204,headers});
    try {
      const response=await route(request,env);
      const merged=new Headers(response.headers);
      for(const [k,v] of Object.entries(headers)) if(v) merged.set(k,v);
      return new Response(response.body,{status:response.status,headers:merged});
    } catch(e) {
      if(e instanceof HttpError) return json({error:{code:e.code,message:e.message}},e.status);
      console.error("API error",String(e?.message||e).slice(0,250));
      return json({error:{code:"INTERNAL_ERROR",message:"Something went wrong. Please try again."}},500);
    }
  }
};

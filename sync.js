// Sync between devices through Firebase (email + password sign-in, Cloud Firestore).
//
// The app always works from its own saved copy (localStorage). Sync keeps `base`: the last state the
// server confirmed. Whatever differs between base and the current state is this device's unsent change, so
//   new state = server state + unsent changes
// Both are compared field by field, so checking one goal on the phone and another on the PC keeps both.
// Nothing counts as sent until the server confirms it; changes made offline survive closing the app.
//
// Cloud layout: users/{uid}/data/settings and users/{uid}/data/{YYYY-MM}
import { firebaseConfig } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/13.4.0/";
const GC = window.GC;
const $ = (id) => document.getElementById(id);

// ---------- app state <-> flat field map ----------
const SEP = "\u0000";
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

// lists are stored as maps keyed by id, with `o` keeping the order
function putList(out, prefix, list) {
  let max = -1;
  for (const x of list) if (typeof x.o === "number") max = Math.max(max, x.o);
  for (const x of list) {
    if (typeof x.o !== "number") x.o = ++max;
    for (const [k, v] of Object.entries(x)) if (k !== "id" && v !== undefined) out.set([...prefix, x.id, k].join(SEP), JSON.stringify(v));
  }
}
export function flatten(state) {
  const out = new Map();
  putList(out, ["settings", "recurring"], state.settings.recurring);
  putList(out, ["settings", "weekly"], state.settings.weekly);
  for (const [mk, m] of Object.entries(state.months)) {
    for (const [key, d] of Object.entries(m.days || {})) {
      for (const id of Object.keys(d.done || {})) if (d.done[id]) out.set([mk, "days", key, "done", id].join(SEP), "true");
      putList(out, [mk, "days", key, "extra"], d.extra || []);
    }
    for (const [key, w] of Object.entries(m.weeks || {})) {
      for (const id of Object.keys(w.done || {})) if (w.done[id]) out.set([mk, "weeks", key, "done", id].join(SEP), "true");
      putList(out, [mk, "weeks", key, "items"], w.items || []);
    }
  }
  return out;
}
function getList(map) {
  // an entry without a title is what is left when one device deleted it while another edited it
  return Object.entries(isObj(map) ? map : {})
    .filter(([, v]) => isObj(v) && typeof v.title === "string")
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => (a.o ?? 0) - (b.o ?? 0) || (a.id < b.id ? -1 : 1));
}
const getDone = (map) => Object.fromEntries(Object.entries(isObj(map) ? map : {}).filter(([, v]) => v === true));
// docs: { settings: {...}, "2026-11": {...} } exactly as stored in the cloud
export function fromDocs(docs) {
  const st = docs.settings || {};
  const state = {
    settings: {
      recurring: getList(st.recurring).filter((g) => Array.isArray(g.versions) && g.versions.length && typeof g.created === "string"),
      weekly: getList(st.weekly).filter((g) => typeof g.created === "string"),
    },
    months: {},
  };
  for (const [mk, m] of Object.entries(docs)) {
    if (!/^\d{4}-\d{2}$/.test(mk)) continue;
    const month = (state.months[mk] = { days: {}, weeks: {} });
    for (const [k, d] of Object.entries(isObj(m.days) ? m.days : {})) month.days[k] = { done: getDone(d.done), extra: getList(d.extra) };
    for (const [k, w] of Object.entries(isObj(m.weeks) ? m.weeks : {})) month.weeks[k] = { done: getDone(w.done), items: getList(w.items) };
  }
  return state;
}
export function unflatten(flat) {
  const docs = {};
  for (const [path, v] of flat) {
    const seg = path.split(SEP);
    let o = docs;
    seg.slice(0, -1).forEach((s) => { o = o[s] ||= {}; });
    o[seg[seg.length - 1]] = JSON.parse(v);
  }
  return fromDocs(docs);
}
// changes that turn a into b; null = removed
export function diff(a, b) {
  const d = new Map();
  for (const [k, v] of b) if (a.get(k) !== v) d.set(k, v);
  for (const k of a.keys()) if (!b.has(k)) d.set(k, null);
  return d;
}
export function apply(a, d) {
  const r = new Map(a);
  for (const [k, v] of d) if (v === null) r.delete(k); else r.set(k, v);
  return r;
}

// ---------- sync ----------
let fb = null;          // loaded SDK { auth, db, A, F }
let user = null;
let stop = null;        // unsubscribe from the cloud listener
let base = new Map();   // last state confirmed by the server
let ready = false;      // got the first server state since sign-in
let inflight = false;
let latest = null;      // server state received while a write was in flight
let error = "";
let online = true;
let flushT;

const keepBase = () => { GC.meta = user ? { uid: user.uid, base: Object.fromEntries(base) } : GC.meta; GC.persist(); };
const unsent = () => diff(base, flatten(GC.state()));

function useState(flat) {
  if (diff(flatten(GC.state()), flat).size) GC.replace(unflatten(flat));
}

function onServer(docs) {
  const server = flatten(fromDocs(docs));
  const mine = flatten(GC.state());
  // the cloud copy disappeared (wiped in the console): put this device's copy back instead of erasing it
  if (!server.size && base.size && mine.size) base = new Map();
  const changes = diff(base, mine);
  base = server;
  ready = true;
  error = "";
  useState(apply(server, changes));
  keepBase();
  paint();
  if (changes.size) flush();
}

async function flush() {
  if (!user || !ready || inflight) return;
  const changes = unsent();
  if (!changes.size) { paint(); return; }
  inflight = true;
  const uid = user.uid;
  paint();
  try {
    await write(uid, changes);
    if (user?.uid !== uid) return;
    base = apply(base, changes);
    error = "";
    keepBase();
  } catch (e) {
    if (user?.uid === uid) error = message(e);
    return;
  } finally {
    inflight = false;
    const l = latest; latest = null;
    if (user?.uid === uid && l) onServer(l);
    paint();
  }
  if (unsent().size) flush();
}

async function write(uid, changes) {
  const { F, db } = fb;
  const docs = {};
  for (const [path, v] of changes) {
    const seg = path.split(SEP);
    let o = docs;
    seg.slice(0, -1).forEach((s) => { o = o[s] ||= {}; });
    o[seg[seg.length - 1]] = v === null ? F.deleteField() : JSON.parse(v);
  }
  const b = F.writeBatch(db);
  for (const [name, data] of Object.entries(docs)) b.set(F.doc(db, "users", uid, "data", name), data, { merge: true });
  await b.commit(); // resolves only when the server has it
}

function listen() {
  stop?.();
  const { F, db } = fb;
  stop = F.onSnapshot(F.collection(db, "users", user.uid, "data"), { includeMetadataChanges: true }, (snap) => {
    online = !snap.metadata.fromCache;
    if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) { latest = null; paint(); return; }
    const docs = {};
    snap.forEach((d) => { docs[d.id] = d.data(); });
    if (inflight) latest = docs; else onServer(docs);
  }, (e) => { stop = null; error = message(e); paint(); });
}

async function onUser(u) {
  stop?.(); stop = null;
  ready = false; latest = null; error = "";
  if (!u) { user = null; base = new Map(); paint(); return; }
  const saved = GC.meta;
  if (saved && saved.uid !== u.uid) {
    // records on this device belong to another account
    const left = diff(new Map(Object.entries(saved.base || {})), flatten(GC.state()));
    if (left.size) {
      user = null;
      await fb.A.signOut(fb.auth);
      error = "다른 계정의 아직 올리지 못한 기록이 이 기기에 있어요. 그 계정으로 먼저 로그인해 주세요.";
      paint();
      return;
    }
    GC.meta = null;
    GC.replace({ settings: { recurring: [], weekly: [] }, months: {} });
  }
  user = u;
  base = new Map(Object.entries((saved && saved.uid === u.uid && saved.base) || {}));
  paint();
  listen();
}

function message(e) {
  const c = e?.code || "";
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return "이메일이나 비밀번호가 맞지 않아요.";
  if (/invalid-email/.test(c)) return "이메일 주소를 확인해 주세요.";
  if (/too-many-requests/.test(c)) return "시도가 많아 잠시 막혔어요. 조금 뒤에 다시 해 주세요.";
  if (/network|unavailable/.test(c)) return "인터넷 연결을 확인해 주세요.";
  if (/permission-denied/.test(c)) return "저장소 권한이 거부됐어요. Firestore 규칙을 확인해 주세요.";
  if (/resource-exhausted/.test(c)) return "오늘 무료 사용량을 다 썼어요. 기록은 이 기기에 남아 있고 나중에 올라가요.";
  return "연동 중 문제가 생겼어요" + (c ? ` (${c})` : "") + ".";
}

// ---------- screen ----------
function paint() {
  $("syncOut").hidden = !!user;
  $("syncIn").hidden = !user;
  $("syncErr").textContent = error;
  $("syncErr").hidden = !error;
  $("backupNote").textContent = user
    ? "기록은 이 계정으로 로그인한 기기끼리 맞춰져요. 만약을 위해 파일로도 저장할 수 있어요."
    : "기록은 이 기기에만 저장돼요. 로그인하면 다른 기기와 맞춰져요.";
  if (!user) return;
  $("syncEmail").textContent = user.email || "";
  const pending = unsent().size > 0;
  $("syncState").textContent = !ready || !online
    ? (pending ? "연결되면 바뀐 기록을 올려요" : "연결 중…")
    : pending ? "올리는 중…" : "연동됨";
}

async function start() {
  if (!firebaseConfig) return;
  $("syncCard").hidden = false;
  paint();
  if (!fb) {
    try {
      const [{ initializeApp }, A, F] = await Promise.all([import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"), import(SDK + "firebase-firestore.js")]);
      const app = initializeApp(firebaseConfig);
      const auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence] });
      fb = { A, F, auth, db: F.initializeFirestore(app, { localCache: F.memoryLocalCache() }) };
      A.onAuthStateChanged(auth, onUser);
      error = "";
    } catch (e) {
      // a failed module import stays failed for this page, so a reload is needed
      error = "연동 기능을 불러오지 못했어요. 인터넷 연결을 확인하고 앱을 다시 열어 주세요.";
    }
    paint();
  }
}

if (firebaseConfig) {
  window.GCSync = { changed() { clearTimeout(flushT); flushT = setTimeout(flush, 250); paint(); } };
  const retry = () => { if (!fb || !user) return; if (!stop) listen(); flush(); };
  window.addEventListener("online", retry);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") retry(); });

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!fb) return;
    const email = $("loginEmail").value.trim(), pw = $("loginPw").value;
    if (!email || !pw) { error = "이메일과 비밀번호를 입력해 주세요."; paint(); return; }
    $("loginBtn").disabled = true;
    error = ""; paint();
    try { await fb.A.signInWithEmailAndPassword(fb.auth, email, pw); $("loginPw").value = ""; }
    catch (err) { error = message(err); paint(); }
    finally { $("loginBtn").disabled = false; }
  });
  $("resetPw").onclick = async () => {
    const email = $("loginEmail").value.trim();
    if (!email) { error = "위에 이메일을 먼저 적어 주세요."; paint(); return; }
    if (!fb) return;
    try { await fb.A.sendPasswordResetEmail(fb.auth, email); error = ""; GC.toast("비밀번호 재설정 메일을 보냈어요"); }
    catch (err) { error = message(err); }
    paint();
  };
  // signing out removes this device's copy, but only once the cloud has everything
  $("logoutBtn").onclick = async () => {
    $("logoutBtn").disabled = true;
    try {
      flush();
      const t0 = Date.now();
      while ((!ready || inflight || unsent().size) && Date.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 100));
      if (!ready || inflight || unsent().size) { error = "아직 올리지 못한 기록이 있어서 로그아웃하지 않았어요. 인터넷 연결을 확인해 주세요."; paint(); return; }
      stop?.(); stop = null; user = null;
      GC.meta = null;
      GC.replace({ settings: { recurring: [], weekly: [] }, months: {} });
      await fb.A.signOut(fb.auth);
      GC.toast("로그아웃했어요. 기록은 계정에 남아 있어요");
    } finally { $("logoutBtn").disabled = false; paint(); }
  };
}
start();

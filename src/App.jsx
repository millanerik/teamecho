import { useState, useEffect, useRef } from "react";
import {
  loadRoster,
  verifyPin,
  setPin as sbSetPin,
  loadBoard,
  addBoardItem,
  updateBoardItem,
  deleteBoardItem,
  uploadBoardMedia,
  setAvatar as sbSetAvatar,
} from "./supabase.js";

/* ============================================================
   TEAM ECHO — internal team hub
   - Splash login: username + 4-digit PIN (hashed server-side)
   - Shared mood-board home screen (drag & pin images / gifs / notes)
   - Left nav rail scaffold for future pages
   - Light / dark mode toggle (top left)
   Data persists in Supabase (Postgres + Storage), shared across the team.
   Theme preference is the only thing kept in localStorage (per device).
   ============================================================ */

/* ---------- note sticker colors ---------- */
/* The team roster ("users" table) now lives in Supabase and is loaded at
   startup via loadRoster(). See the SQL seed in SUPABASE_SETUP.md. */
const NOTE_COLORS = [
  { id: "sun", light: "#FFE08A", dark: "#8A6D1F" },
  { id: "mint", light: "#A8EDD0", dark: "#1F6B4E" },
  { id: "lilac", light: "#D6CCFF", dark: "#4A3D8F" },
  { id: "sky", light: "#B4E0FF", dark: "#1F4E6B" },
  { id: "rose", light: "#FFC9D6", dark: "#7A2E44" },
];

const initials = (name) =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* Downscale static images so they stay small in storage.
   GIFs are kept as-is (canvas would destroy the animation). */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

async function processImage(file, maxDim = 900) {
  if (!file.type.startsWith("image/")) throw new Error("Only images and GIFs can be pinned.");
  if (file.type === "image/gif") {
    if (file.size > 2.5 * 1024 * 1024) throw new Error("GIFs need to be under 2.5 MB.");
    return fileToDataUrl(file);
  }
  const dataUrl = await fileToDataUrl(file);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Could not load image"));
    i.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  return canvas.toDataURL(type, 0.85);
}

/* ============================ styles ============================ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap');

:root{
  --font-display:'Sora',ui-sans-serif,system-ui,sans-serif;
  --font-body:'Inter',ui-sans-serif,system-ui,sans-serif;
  /* gradient accent stops shared across themes */
  --grad-a:#8B5CF6; --grad-b:#A78BFA; --grad-c:#6D4AFF;
}
[data-theme="light"]{
  --bg-a:#F4F1FB; --bg-b:#EDE9F7;
  --page:#F4F1FB;
  --surface:rgba(255,255,255,.70);
  --surface-solid:#FFFFFF;
  --panel:#FFFFFF;
  --panel-2:#F7F5FD;
  --border:rgba(60,40,100,.12);
  --border-soft:rgba(60,40,100,.07);
  --ink:#241832; --ink-soft:#5F5478; --ink-faint:#918AA6;
  --accent-a:#7C3AED; --accent-b:#A78BFA;
  --ring-ink:rgba(60,40,100,.16);
  --canvas-dot:rgba(60,40,100,.09);
  --glow:rgba(124,58,237,.20);
  --shadow:0 14px 40px rgba(74,36,120,.14);
  --sticker-shadow:0 10px 26px rgba(74,36,120,.18);
  --nav-active:linear-gradient(100deg, rgba(124,58,237,.14), rgba(167,139,250,.10));
}
[data-theme="dark"]{
  --bg-a:#0E0B1A; --bg-b:#120C22;
  --page:#0B0814;
  --surface:rgba(28,22,48,.55);
  --surface-solid:#181330;
  --panel:#16112B;
  --panel-2:#1C1638;
  --border:rgba(150,130,220,.14);
  --border-soft:rgba(150,130,220,.08);
  --ink:#EDE9FB; --ink-soft:#A79FC9; --ink-faint:#6E6690;
  --accent-a:#9B7CFF; --accent-b:#B49CFF;
  --ring-ink:rgba(200,185,255,.16);
  --canvas-dot:rgba(180,160,255,.07);
  --glow:rgba(120,80,240,.32);
  --shadow:0 18px 48px rgba(0,0,0,.50);
  --sticker-shadow:0 12px 30px rgba(0,0,0,.55);
  --nav-active:linear-gradient(100deg, rgba(139,92,246,.28), rgba(109,74,255,.14));
}

.te-root{
  font-family:var(--font-body);
  color:var(--ink);
  min-height:100vh;
  background:
    radial-gradient(1100px 720px at 78% -8%, var(--glow), transparent 58%),
    radial-gradient(760px 620px at -8% 108%, color-mix(in srgb, var(--accent-b) 22%, transparent), transparent 60%),
    var(--page);
  transition:background .35s ease, color .35s ease;
}
.te-root *{box-sizing:border-box}
.te-root button{font-family:inherit}
.te-root button:focus-visible, .te-root input:focus-visible, .te-root textarea:focus-visible{
  outline:2px solid var(--accent-a); outline-offset:2px; border-radius:8px;
}

/* ---------- echo wordmark ---------- */
.echo-stack{position:relative; display:grid; place-items:center; user-select:none; pointer-events:none; z-index:1;}
.echo-stack span{
  grid-area:1/1;
  font-family:var(--font-display); font-weight:800; letter-spacing:-.02em;
  white-space:nowrap; line-height:1;
}
.echo-core{
  background:linear-gradient(100deg, var(--accent-a), var(--accent-b));
  -webkit-background-clip:text; background-clip:text; color:transparent;
}
.echo-ring{color:transparent; -webkit-text-stroke:1px var(--ring-ink);}
.echo-ring.r1{transform:scale(1.06,1.14); opacity:.30}
.echo-ring.r2{transform:scale(1.12,1.30); opacity:.16}
.echo-ring.r3{transform:scale(1.18,1.48); opacity:.07}
@media (prefers-reduced-motion: no-preference){
  .echo-ring.r1{animation:echo-b1 6s ease-in-out infinite}
  @keyframes echo-b1{0%,100%{opacity:.30}50%{opacity:.16}}
  .echo-ring.r2{animation:echo-b2 6s ease-in-out infinite .6s}
  @keyframes echo-b2{0%,100%{opacity:.16}50%{opacity:.07}}
  .echo-ring.r3{animation:echo-b3 6s ease-in-out infinite 1.2s}
  @keyframes echo-b3{0%,100%{opacity:.07}50%{opacity:.02}}
}

/* ---------- shared bits ---------- */
.te-btn{
  border:1px solid var(--border); background:var(--surface); color:var(--ink);
  border-radius:999px; padding:10px 18px; font-size:14px; font-weight:600;
  cursor:pointer; display:inline-flex; align-items:center; gap:8px;
  transition:transform .12s ease, box-shadow .12s ease, background .2s, border-color .2s;
  backdrop-filter:blur(10px);
}
.te-btn:hover{transform:translateY(-1px); box-shadow:var(--shadow); border-color:color-mix(in srgb, var(--accent-a) 40%, var(--border))}
.te-btn.primary{
  border:none; color:#fff;
  background:linear-gradient(100deg, var(--grad-c), var(--grad-a) 55%, var(--grad-b));
  box-shadow:0 8px 22px color-mix(in srgb, var(--grad-c) 45%, transparent);
}
.te-btn.primary:hover{box-shadow:0 12px 30px color-mix(in srgb, var(--grad-c) 55%, transparent)}
.te-btn.icon{padding:10px; border-radius:14px}
.te-input{
  width:100%; border:1px solid var(--border); background:var(--panel-2);
  color:var(--ink); border-radius:14px; padding:12px 15px; font-size:14px;
  transition:border-color .15s, box-shadow .15s;
}
.te-input:focus{outline:none; border-color:color-mix(in srgb, var(--accent-a) 55%, var(--border)); box-shadow:0 0 0 3px color-mix(in srgb, var(--accent-a) 18%, transparent)}
.te-input::placeholder{color:var(--ink-faint)}
.avatar{
  border-radius:50%; overflow:hidden; flex:none;
  display:grid; place-items:center;
  background:linear-gradient(135deg, var(--grad-c), var(--grad-b));
  color:#fff; font-family:var(--font-display); font-weight:700;
  box-shadow:0 0 0 1px var(--border-soft);
}
.avatar img{width:100%; height:100%; object-fit:cover}
.role-chip{
  font-size:10.5px; font-weight:600; letter-spacing:.04em; text-transform:uppercase;
  padding:3px 9px; border-radius:999px; border:1px solid var(--border);
  color:var(--ink-soft); background:var(--surface);
}
.role-chip.admin{
  color:#fff; border:none;
  background:linear-gradient(100deg, var(--grad-c), var(--grad-b));
}

/* ---------- login ---------- */
.login-wrap{min-height:100vh; display:grid; place-items:center; padding:24px; position:relative; overflow:hidden}
.login-panel{
  position:relative; z-index:1; width:min(680px,100%);
  background:linear-gradient(160deg, color-mix(in srgb, var(--panel) 92%, var(--accent-a) 8%), var(--panel));
  border:1px solid var(--border); border-radius:28px;
  box-shadow:var(--shadow); backdrop-filter:blur(20px); padding:44px 40px 34px;
  overflow:hidden;
}
.login-panel::before{
  content:""; position:absolute; top:-40%; left:-10%; width:60%; height:80%;
  background:radial-gradient(circle, color-mix(in srgb, var(--accent-a) 34%, transparent), transparent 60%);
  pointer-events:none; filter:blur(8px);
}
.login-sub{color:var(--ink-soft); font-size:14px; text-align:center; margin:14px 0 26px; position:relative}
.login-form{max-width:360px; margin:0 auto; display:flex; flex-direction:column; gap:14px; position:relative; z-index:1}
.field-label{font-size:12px; font-weight:600; letter-spacing:.03em; color:var(--ink-soft); margin-bottom:6px; display:block}
.select-wrap{position:relative}
.select-wrap svg{position:absolute; right:14px; top:50%; transform:translateY(-50%); pointer-events:none; color:var(--ink-faint)}
.te-select{
  width:100%; border:1px solid var(--border); background:var(--surface-solid);
  color:var(--ink); border-radius:12px; padding:12px 40px 12px 14px; font-size:14px;
  font-family:inherit; appearance:none; cursor:pointer;
}
.te-select:invalid{color:var(--ink-faint)}
.selected-user{
  display:flex; align-items:center; gap:11px; padding:10px 12px;
  border:1px solid var(--border); background:var(--surface-solid); border-radius:14px;
}
.selected-user .nm{font-weight:600; font-size:14px; line-height:1.2}
.pin-boxes{display:flex; gap:10px; justify-content:center; margin:2px 0}
.pin-box{
  width:52px; height:60px; text-align:center; font-size:24px; font-weight:700;
  font-family:var(--font-display); color:var(--ink);
  border:1px solid var(--border); background:var(--surface-solid); border-radius:14px;
  transition:border-color .12s, box-shadow .12s;
}
.pin-box:focus{outline:none; border-color:var(--accent-a); box-shadow:0 0 0 3px color-mix(in srgb, var(--accent-a) 22%, transparent)}
.pin-box.filled{border-color:color-mix(in srgb, var(--accent-a) 50%, var(--border))}
.login-error{color:#E0567F; font-size:12.5px; text-align:center}
.login-note{font-size:12px; color:var(--ink-faint); text-align:center; line-height:1.5}
.bg-ripple{position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); border-radius:50%; border:1.5px solid var(--ring-ink); pointer-events:none}

/* ---------- app shell (floating sidebar like SpaceWallet) ---------- */
.shell{display:flex; min-height:100vh; padding:16px; gap:16px}
.rail{
  width:236px; flex:none; display:flex; flex-direction:column; gap:4px;
  padding:18px 14px; border:1px solid var(--border); border-radius:24px;
  background:linear-gradient(180deg, color-mix(in srgb, var(--panel) 88%, var(--accent-a) 12%), var(--panel) 40%);
  box-shadow:var(--shadow); position:relative; overflow:hidden;
}
.rail::before{
  content:""; position:absolute; top:-30%; left:50%; transform:translateX(-50%);
  width:120%; height:40%;
  background:radial-gradient(circle, color-mix(in srgb, var(--accent-a) 30%, transparent), transparent 65%);
  pointer-events:none;
}
.rail>*{position:relative; z-index:1}
.rail .brand{display:flex; align-items:center; gap:11px; padding:4px 8px 18px}
.brand-mark{
  width:36px; height:36px; border-radius:12px; display:grid; place-items:center;
  background:linear-gradient(135deg, var(--grad-c), var(--grad-b));
  color:#fff; font-family:var(--font-display); font-weight:800; font-size:14px;
  box-shadow:0 6px 16px color-mix(in srgb, var(--grad-c) 45%, transparent);
}
.brand-name{font-family:var(--font-display); font-weight:700; font-size:15.5px; letter-spacing:-.01em}
.nav-item{
  position:relative;
  display:flex; align-items:center; gap:11px; padding:11px 13px; border-radius:14px;
  border:none; background:transparent; color:var(--ink-soft); font-size:14px; font-weight:500;
  cursor:pointer; width:100%; text-align:left; transition:color .15s, background .15s;
}
.nav-item:not(.ghost):not(.active):hover{color:var(--ink); background:color-mix(in srgb, var(--accent-a) 8%, transparent)}
.nav-item.active{
  color:var(--ink); background:var(--nav-active);
  box-shadow:inset 0 0 0 1px var(--border-soft);
  font-weight:600;
}
.nav-item.active::before{
  content:""; position:absolute; left:5px; top:50%; transform:translateY(-50%);
  width:3px; height:18px; border-radius:2px;
  background:linear-gradient(180deg, var(--grad-a), var(--grad-c));
}
.nav-item.ghost{color:var(--ink-faint); cursor:default}
.nav-item.ghost:hover{color:var(--ink-faint)}
.rail-label{font-size:10px; letter-spacing:.11em; text-transform:uppercase; color:var(--ink-faint); padding:16px 13px 6px; font-weight:700}
.rail-me{
  margin-top:auto; display:flex; align-items:center; gap:10px; padding:11px;
  border:1px solid var(--border); border-radius:16px;
  background:color-mix(in srgb, var(--panel-2) 80%, transparent);
}
.rail-me .who{min-width:0; display:flex; flex-direction:column; gap:3px; align-items:flex-start}
.rail-me .who .n{font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:110px}
.rail-me .role-chip{white-space:nowrap}

/* ---------- top bar + canvas ---------- */
.main{flex:1; display:flex; flex-direction:column; min-width:0; gap:16px}
.topbar{
  display:flex; align-items:center; gap:12px; padding:16px 20px;
  border:1px solid var(--border); border-radius:22px;
  background:linear-gradient(120deg, color-mix(in srgb, var(--panel) 90%, var(--accent-a) 10%), var(--panel));
  box-shadow:var(--shadow);
}
.topbar-title{font-family:var(--font-display); font-weight:700; font-size:17px; letter-spacing:-.01em}
.topbar-title span{
  background:linear-gradient(100deg, var(--grad-a), var(--grad-b));
  -webkit-background-clip:text; background-clip:text; color:transparent;
}
.board-hint{margin-left:auto; font-size:12.5px; color:var(--ink-faint)}
.canvas{
  position:relative; flex:1; border-radius:26px; overflow:hidden;
  border:1px solid var(--border);
  background:
    radial-gradient(700px 420px at 72% 12%, color-mix(in srgb, var(--accent-a) 14%, transparent), transparent 60%),
    var(--panel);
  box-shadow:var(--shadow);
  min-height:520px;
}
.canvas::after{
  content:""; position:absolute; inset:0; pointer-events:none;
  background-image:radial-gradient(var(--canvas-dot) 1px, transparent 1px);
  background-size:24px 24px;
}
.canvas-center{position:absolute; inset:0; display:grid; place-items:center; z-index:1}

/* ---------- stickers ---------- */
.sticker{
  position:absolute; touch-action:none; cursor:grab; user-select:none; z-index:2;
  filter:drop-shadow(0 0 0 transparent);
}
.sticker.dragging{cursor:grabbing}
.sticker .inner{
  border-radius:16px; overflow:hidden; box-shadow:var(--sticker-shadow);
  border:1px solid var(--border); background:var(--panel-2);
  transition:transform .12s ease;
}
.sticker:hover .inner{transform:scale(1.02)}
.sticker img{display:block; width:100%; height:auto; pointer-events:none}
.sticker .note{
  padding:15px 17px; font-size:13.5px; line-height:1.45; font-weight:500;
  color:#26213A; width:100%; height:100%; white-space:pre-wrap; word-break:break-word;
}
.sticker .meta{
  position:absolute; left:8px; bottom:-22px; font-size:10.5px; color:var(--ink-faint);
  opacity:0; transition:opacity .15s; white-space:nowrap;
}
.sticker:hover .meta{opacity:1}
.sticker .del{
  position:absolute; top:-9px; right:-9px; width:22px; height:22px; border-radius:50%;
  border:none; background:var(--ink); color:var(--surface-solid); font-size:12px; line-height:1;
  cursor:pointer; opacity:0; transition:opacity .15s; display:grid; place-items:center;
}
.sticker:hover .del{opacity:1}

/* ---------- add menu / modals ---------- */
.fab{
  position:absolute; right:24px; bottom:24px; width:56px; height:56px; border-radius:20px;
  border:none; color:#fff; font-size:26px; cursor:pointer; z-index:5;
  background:linear-gradient(135deg, var(--grad-c), var(--grad-a) 55%, var(--grad-b));
  box-shadow:0 12px 30px color-mix(in srgb, var(--grad-c) 50%, transparent); display:grid; place-items:center;
  transition:transform .12s ease, box-shadow .12s ease;
}
.fab:hover{transform:translateY(-2px) scale(1.05); box-shadow:0 16px 38px color-mix(in srgb, var(--grad-c) 60%, transparent)}
.add-menu{
  position:absolute; right:24px; bottom:90px; width:236px; padding:8px;
  background:var(--panel-2); border:1px solid var(--border); border-radius:18px;
  box-shadow:var(--shadow); display:flex; flex-direction:column; gap:4px; z-index:6;
}
.add-menu button{
  display:flex; align-items:center; gap:10px; padding:12px 13px; border-radius:13px;
  border:none; background:transparent; color:var(--ink); font-size:13.5px; font-weight:500;
  cursor:pointer; text-align:left; width:100%; transition:background .15s;
}
.add-menu button:hover{background:color-mix(in srgb, var(--accent-a) 12%, transparent)}
.overlay{
  position:fixed; inset:0; background:rgba(8,6,18,.55); z-index:80;
  display:grid; place-items:center; padding:20px; backdrop-filter:blur(4px);
}
.modal{
  width:min(420px,100%);
  background:linear-gradient(160deg, color-mix(in srgb, var(--panel) 90%, var(--accent-a) 10%), var(--panel));
  border:1px solid var(--border);
  border-radius:24px; box-shadow:var(--shadow); padding:24px;
}
.modal h3{margin:0 0 4px; font-family:var(--font-display); font-size:17px}
.modal p.sub{margin:0 0 16px; font-size:13px; color:var(--ink-soft)}
.swatches{display:flex; gap:8px; margin:12px 0 16px}
.swatch{width:30px; height:30px; border-radius:50%; cursor:pointer; border:2px solid transparent; transition:transform .12s}
.swatch.sel{border-color:var(--accent-a); transform:scale(1.12)}
.modal-actions{display:flex; justify-content:flex-end; gap:8px; margin-top:6px}
.toast{
  position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
  background:var(--panel-2); color:var(--ink); border:1px solid var(--border);
  font-size:13px; font-weight:500;
  padding:11px 18px; border-radius:14px; z-index:100; box-shadow:var(--shadow);
}
.spinner{
  width:22px; height:22px; border-radius:50%; border:3px solid var(--border);
  border-top-color:var(--accent-a); animation:te-spin .8s linear infinite;
}
@keyframes te-spin{to{transform:rotate(360deg)}}
@media (max-width:760px){
  .shell{padding:10px; gap:10px}
  .rail{width:72px; padding:16px 10px}
  .rail .brand-name, .nav-item .lbl, .rail-me .who, .rail-me .role-chip, .rail-label{display:none}
  .nav-item{justify-content:center}
  .rail-me{justify-content:center}
}
`;

/* ============================ components ============================ */

function EchoWordmark({ size = 72 }) {
  const style = { fontSize: size };
  return (
    <div className="echo-stack" aria-hidden="true">
      <span className="echo-ring r3" style={style}>Team Echo</span>
      <span className="echo-ring r2" style={style}>Team Echo</span>
      <span className="echo-ring r1" style={style}>Team Echo</span>
      <span className="echo-core" style={style}>Team Echo</span>
    </div>
  );
}

function Avatar({ user, size = 38 }) {
  const pic = user?.avatar_url;
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {pic ? <img src={pic} alt={user.name} /> : initials(user.name)}
    </div>
  );
}

function ThemeToggle({ theme, onToggle }) {
  return (
    <button
      className="te-btn icon"
      onClick={onToggle}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      {theme === "light" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}

/* ============================ main app ============================ */

export default function TeamEcho() {
  const [theme, setTheme] = useState("dark");
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState("");
  const [users, setUsers] = useState([]);         // roster loaded from Supabase
  const [me, setMe] = useState(null);             // logged-in user object
  const [selId, setSelId] = useState("");         // chosen username in dropdown
  const [verifying, setVerifying] = useState(false);
  const [pinDigits, setPinDigits] = useState(["", "", "", ""]);
  const [confirmDigits, setConfirmDigits] = useState(["", "", "", ""]);
  const [loginError, setLoginError] = useState("");

  const [items, setItems] = useState([]);         // board stickers
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteColor, setNoteColor] = useState("sun");
  const [profileOpen, setProfileOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const profileFileRef = useRef(null);
  const dragRef = useRef(null);
  const zRef = useRef(10);
  const pinRefs = useRef([]);
  const confirmRefs = useRef([]);

  const say = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2600);
  };

  /* ---------- boot: theme from localStorage, roster from Supabase ---------- */
  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem("te-theme");
      if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
    } catch {}

    (async () => {
      try {
        const roster = await loadRoster();
        setUsers(roster);
      } catch (e) {
        console.error(e);
        setBootError("Couldn't reach the team database. Check your connection and try again.");
      }
      setBooted(true);
    })();
  }, []);

  // Refresh the roster (e.g. after an avatar upload or PIN creation).
  const refreshRoster = async () => {
    try { setUsers(await loadRoster()); } catch (e) { console.error(e); }
  };

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    try { localStorage.setItem("te-theme", next); } catch {}
  };

  /* ---------- login (username + 4-digit PIN) ---------- */
  const selUser = users.find((u) => u.id === selId) || null;
  const isFirstLogin = selUser && !selUser.has_pin;   // no PIN set in DB yet

  const resetPinFields = () => {
    setPinDigits(["", "", "", ""]);
    setConfirmDigits(["", "", "", ""]);
    setLoginError("");
  };

  const onSelectUser = (id) => {
    setSelId(id);
    resetPinFields();
    setTimeout(() => pinRefs.current[0]?.focus(), 30);
  };

  // shared handler for a group of 4 boxes
  const handleDigit = (idx, val, digits, setDigits, refs, onComplete) => {
    if (val && !/^\d$/.test(val)) return;
    const next = [...digits];
    next[idx] = val;
    setDigits(next);
    setLoginError("");
    if (val && idx < 3) refs.current[idx + 1]?.focus();
    if (val && idx === 3 && onComplete) {
      const full = next.join("");
      if (full.length === 4) setTimeout(() => onComplete(full), 10);
    }
  };

  const handleKeyDown = (idx, e, digits, refs) => {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
    }
  };

  const doLogin = async (enteredPin) => {
    if (!selUser || verifying) return;
    setVerifying(true);
    try {
      const ok = await verifyPin(selUser.id, enteredPin);
      if (ok) {
        setMe(selUser);
        setSelId("");
        resetPinFields();
      } else {
        setLoginError("Incorrect PIN. Try again.");
        setPinDigits(["", "", "", ""]);
        pinRefs.current[0]?.focus();
      }
    } catch (e) {
      console.error(e);
      setLoginError("Couldn't reach the server. Try again.");
    }
    setVerifying(false);
  };

  const createPin = async (confirmOverride) => {
    if (verifying) return;
    const pin = pinDigits.join("");
    const confirm = confirmOverride != null ? confirmOverride : confirmDigits.join("");
    if (pin.length < 4) { setLoginError("Enter all four digits."); return; }
    if (confirm.length < 4) { setLoginError("Re-enter your PIN to confirm."); return; }
    if (pin !== confirm) {
      setLoginError("Those PINs don't match. Try again.");
      setConfirmDigits(["", "", "", ""]);
      confirmRefs.current[0]?.focus();
      return;
    }
    setVerifying(true);
    try {
      await sbSetPin(selUser.id, pin);
      // reflect has_pin locally so a re-select shows the login form
      setUsers((prev) => prev.map((u) => (u.id === selUser.id ? { ...u, has_pin: true } : u)));
      setMe({ ...selUser, has_pin: true });
      setSelId("");
      resetPinFields();
    } catch (e) {
      console.error(e);
      setLoginError("Couldn't save your PIN. Try again.");
    }
    setVerifying(false);
  };

  /* ---------- board loading ---------- */
  useEffect(() => {
    if (!me) return;
    (async () => {
      setLoadingBoard(true);
      try {
        const loaded = await loadBoard();
        zRef.current = loaded.length ? Math.max(...loaded.map((i) => i.z || 0)) + 1 : 10;
        setItems(loaded);
      } catch (e) {
        console.error(e);
        say("Couldn't load the board.");
      }
      setLoadingBoard(false);
    })();
  }, [me]);

  // Add a fully-formed item (src already uploaded for images) to board + DB.
  const addItem = async (partial) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const item = {
      id: uid(),
      owner: me.id,
      ownerName: me.name,
      x: 38 + Math.random() * 24,             // % of canvas width
      y: 22 + Math.random() * 40,             // % of canvas height
      rot: Math.round((Math.random() * 12 - 6) * 10) / 10,
      w: partial.type === "text" ? 190 : 180, // px
      z: zRef.current++,
      ...partial,
    };
    if (rect && rect.width < 700) item.x = 20 + Math.random() * 40;
    setItems((prev) => [...prev, item]);       // optimistic
    try {
      await addBoardItem(item);
    } catch (e) {
      console.error(e);
      setItems((prev) => prev.filter((i) => i.id !== item.id)); // roll back
      say("Couldn't save that pin.");
    }
    return item;
  };

  const removeItem = async (item) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await deleteBoardItem(item.id);
    } catch (e) {
      console.error(e);
      say("Couldn't remove that pin.");
    }
  };

  /* ---------- drag & drop ---------- */
  const onStickerDown = (e, item) => {
    if (e.target.closest(".del")) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const newZ = zRef.current++;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, z: newZ } : i)));
    dragRef.current = {
      id: item.id,
      rect,
      startX: e.clientX,
      startY: e.clientY,
      origX: item.x,
      origY: item.y,
      moved: false,
      z: newZ,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onStickerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = ((e.clientX - d.startX) / d.rect.width) * 100;
    const dy = ((e.clientY - d.startY) / d.rect.height) * 100;
    if (Math.abs(dx) + Math.abs(dy) > 0.2) d.moved = true;
    d.lastX = Math.min(96, Math.max(-4, d.origX + dx));
    d.lastY = Math.min(96, Math.max(-2, d.origY + dy));
    setItems((prev) =>
      prev.map((i) => (i.id === d.id ? { ...i, x: d.lastX, y: d.lastY } : i))
    );
  };

  const onStickerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    setItems((prev) => {
      const it = prev.find((i) => i.id === d.id);
      // persist final position + stacking order once, after the drag ends
      if (it) {
        updateBoardItem(it.id, { x: it.x, y: it.y, z: it.z }).catch((e) => {
          console.error(e);
        });
      }
      return prev;
    });
  };

  /* ---------- uploads ---------- */
  const onPickBoardFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const kind = file.type === "image/gif" ? "gif" : "image";
      const ext = kind === "gif" ? "gif" : "jpg";
      const dataUrl = await processImage(file, 900);
      const itemId = uid();
      // Upload to Supabase Storage, then pin the returned public URL.
      const publicUrl = await uploadBoardMedia(me.id, itemId, dataUrl, ext);
      await addItem({ id: itemId, type: kind, src: publicUrl });
    } catch (err) {
      console.error(err);
      say(err.message || "Couldn't add that file.");
    }
    setBusy(false);
    setAddOpen(false);
  };

  const onPickProfileFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await processImage(file, 300);
      const url = await sbSetAvatar(me.id, dataUrl);
      // reflect new avatar locally
      setUsers((prev) => prev.map((u) => (u.id === me.id ? { ...u, avatar_url: url } : u)));
      setMe((m) => ({ ...m, avatar_url: url }));
      say("Profile photo updated.");
      setProfileOpen(false);
    } catch (err) {
      console.error(err);
      say(err.message || "Couldn't update your photo.");
    }
    setBusy(false);
  };

  const submitNote = async () => {
    if (!noteText.trim()) return;
    await addItem({ type: "text", text: noteText.trim().slice(0, 280), color: noteColor });
    setNoteText("");
    setNoteOpen(false);
    setAddOpen(false);
  };

  const isAdmin = me?.role === "Super Admin";

  /* ============================ render ============================ */

  if (!booted) {
    return (
      <div className="te-root" data-theme={theme} style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <style>{CSS}</style>
        <div className="spinner" />
      </div>
    );
  }

  /* ---------- login screen ---------- */
  if (!me) {
    return (
      <div className="te-root" data-theme={theme}>
        <style>{CSS}</style>
        <div className="login-wrap">
          {[520, 780, 1060].map((s, i) => (
            <div key={s} className="bg-ripple" style={{ width: s, height: s, opacity: 0.5 - i * 0.15 }} />
          ))}
          <div style={{ position: "absolute", top: 18, left: 18, zIndex: 2 }}>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
          <div className="login-panel">
            <EchoWordmark size={46} />
            <p className="login-sub">
              {isFirstLogin
                ? "First time in — create a 4-digit PIN to secure your account."
                : "Welcome back. Sign in to step inside."}
            </p>

            {bootError && (
              <div className="login-error" style={{ marginBottom: 12 }}>{bootError}</div>
            )}

            <div className="login-form">
              <div>
                <label className="field-label" htmlFor="user-select">Username</label>
                <div className="select-wrap">
                  <select
                    id="user-select"
                    className="te-select"
                    value={selId}
                    required
                    onChange={(e) => onSelectUser(e.target.value)}
                  >
                    <option value="" disabled>Select your name…</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </div>
              </div>

              {selUser && (
                <div className="selected-user">
                  <Avatar user={selUser} size={38} />
                  <div>
                    <div className="nm">{selUser.name}</div>
                    <span className={`role-chip ${selUser.role === "Super Admin" ? "admin" : ""}`}>{selUser.role}</span>
                  </div>
                </div>
              )}

              {selUser && !isFirstLogin && (
                <div>
                  <label className="field-label">PIN</label>
                  <div className="pin-boxes">
                    {pinDigits.map((d, i) => (
                      <input
                        key={i}
                        ref={(el) => (pinRefs.current[i] = el)}
                        className={`pin-box ${d ? "filled" : ""}`}
                        type="password"
                        inputMode="numeric"
                        maxLength={1}
                        value={d}
                        autoFocus={i === 0}
                        onChange={(e) => handleDigit(i, e.target.value, pinDigits, setPinDigits, pinRefs, doLogin)}
                        onKeyDown={(e) => handleKeyDown(i, e, pinDigits, pinRefs)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {selUser && isFirstLogin && (
                <>
                  <div>
                    <label className="field-label">Create a PIN</label>
                    <div className="pin-boxes">
                      {pinDigits.map((d, i) => (
                        <input
                          key={i}
                          ref={(el) => (pinRefs.current[i] = el)}
                          className={`pin-box ${d ? "filled" : ""}`}
                          type="password"
                          inputMode="numeric"
                          maxLength={1}
                          value={d}
                          autoFocus={i === 0}
                          onChange={(e) => handleDigit(i, e.target.value, pinDigits, setPinDigits, pinRefs, () => confirmRefs.current[0]?.focus())}
                          onKeyDown={(e) => handleKeyDown(i, e, pinDigits, pinRefs)}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="field-label">Confirm PIN</label>
                    <div className="pin-boxes">
                      {confirmDigits.map((d, i) => (
                        <input
                          key={i}
                          ref={(el) => (confirmRefs.current[i] = el)}
                          className={`pin-box ${d ? "filled" : ""}`}
                          type="password"
                          inputMode="numeric"
                          maxLength={1}
                          value={d}
                          onChange={(e) => handleDigit(i, e.target.value, confirmDigits, setConfirmDigits, confirmRefs, (full) => createPin(full))}
                          onKeyDown={(e) => handleKeyDown(i, e, confirmDigits, confirmRefs)}
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}

              {loginError && <div className="login-error">{loginError}</div>}

              {selUser && isFirstLogin && (
                <button className="te-btn primary" style={{ justifyContent: "center" }} onClick={createPin}>
                  Set PIN & enter
                </button>
              )}

              {selUser && isFirstLogin && (
                <p className="login-note">You'll use this PIN every time you sign in. Keep it somewhere safe.</p>
              )}
            </div>
          </div>
        </div>
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  /* ---------- main app ---------- */
  return (
    <div className="te-root" data-theme={theme}>
      <style>{CSS}</style>
      <div className="shell">
        {/* left nav rail */}
        <aside className="rail">
          <div className="brand">
            <div className="brand-mark">TE</div>
            <div className="brand-name">Team Echo</div>
          </div>

          <button className="nav-item active">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" />
            </svg>
            <span className="lbl">Home</span>
          </button>

          <div className="rail-label">Coming soon</div>
          {["Tools", "Docs", "Calendar"].map((p) => (
            <div key={p} className="nav-item ghost">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" strokeDasharray="3 4" />
              </svg>
              <span className="lbl">{p}</span>
            </div>
          ))}

          <div className="rail-me">
            <button
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
              onClick={() => setProfileOpen(true)}
              title="Change profile photo"
              aria-label="Change profile photo"
            >
              <Avatar user={me} size={38} />
            </button>
            <div className="who">
              <div className="n">{me.name}</div>
              <span className={`role-chip ${isAdmin ? "admin" : ""}`}>{me.role}</span>
            </div>
            <button
              className="te-btn icon"
              style={{ marginLeft: "auto" }}
              onClick={() => setMe(null)}
              title="Log out"
              aria-label="Log out"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
              </svg>
            </button>
          </div>
        </aside>

        {/* main column */}
        <div className="main">
          <div className="topbar">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <div className="topbar-title">Welcome back, <span>{me.name.split(" ")[0]}</span> 👋</div>
            <div className="board-hint">Drag anything to rearrange the board</div>
          </div>

          <div className="canvas" ref={canvasRef}>
            <div className="canvas-center">
              <EchoWordmark size={Math.min(84, (typeof window !== "undefined" ? window.innerWidth : 1200) / 12)} />
            </div>

            {loadingBoard && (
              <div style={{ position: "absolute", top: 14, left: 14 }}><div className="spinner" /></div>
            )}

            {items.map((item) => {
              const canDelete = isAdmin || item.owner === me.id;
              const noteC = NOTE_COLORS.find((c) => c.id === item.color) || NOTE_COLORS[0];
              return (
                <div
                  key={item.id}
                  className={`sticker ${dragRef.current?.id === item.id ? "dragging" : ""}`}
                  style={{
                    left: `${item.x}%`,
                    top: `${item.y}%`,
                    width: item.w,
                    zIndex: item.z || 1,
                    transform: `rotate(${item.rot}deg)`,
                  }}
                  onPointerDown={(e) => onStickerDown(e, item)}
                  onPointerMove={onStickerMove}
                  onPointerUp={onStickerUp}
                  onPointerCancel={onStickerUp}
                >
                  <div
                    className="inner"
                    style={item.type === "text" ? { background: theme === "dark" ? noteC.dark : noteC.light, minHeight: 70 } : {}}
                  >
                    {item.type === "text" ? (
                      <div className="note" style={{ color: theme === "dark" ? "#F4F2FF" : "#26213A" }}>{item.text}</div>
                    ) : (
                      <img src={item.src} alt={`Pinned by ${item.ownerName}`} draggable={false} />
                    )}
                  </div>
                  <div className="meta">pinned by {item.owner === me.id ? "you" : item.ownerName}</div>
                  {canDelete && (
                    <button className="del" onClick={() => removeItem(item)} aria-label="Remove pin">×</button>
                  )}
                </div>
              );
            })}

            {/* add button + menu */}
            <button className="fab" onClick={() => setAddOpen((v) => !v)} aria-label="Add to the board">
              {addOpen ? "×" : "+"}
            </button>
            {addOpen && (
              <div className="add-menu">
                <button onClick={() => fileRef.current?.click()} disabled={busy}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-4.5-4.5L6 21" />
                  </svg>
                  {busy ? "Uploading…" : "Pin an image or GIF"}
                </button>
                <button onClick={() => { setNoteOpen(true); setAddOpen(false); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                  Pin a note
                </button>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickBoardFile} />
          </div>
        </div>
      </div>

      {/* note modal */}
      {noteOpen && (
        <div className="overlay" onClick={() => setNoteOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Pin a note</h3>
            <p className="sub">Short and sweet — it lands on the board for everyone.</p>
            <textarea
              className="te-input"
              rows={3}
              maxLength={280}
              placeholder="Type something…"
              value={noteText}
              autoFocus
              onChange={(e) => setNoteText(e.target.value)}
            />
            <div className="swatches">
              {NOTE_COLORS.map((c) => (
                <button
                  key={c.id}
                  className={`swatch ${noteColor === c.id ? "sel" : ""}`}
                  style={{ background: theme === "dark" ? c.dark : c.light }}
                  onClick={() => setNoteColor(c.id)}
                  aria-label={`${c.id} note color`}
                />
              ))}
            </div>
            <div className="modal-actions">
              <button className="te-btn" onClick={() => setNoteOpen(false)}>Cancel</button>
              <button className="te-btn primary" onClick={submitNote}>Pin it</button>
            </div>
          </div>
        </div>
      )}

      {/* profile modal */}
      {profileOpen && (
        <div className="overlay" onClick={() => setProfileOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Profile photo</h3>
            <p className="sub">Your photo shows up on the login screen and next to your pins.</p>
            <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "6px 0 16px" }}>
              <Avatar user={me} size={72} />
              <button className="te-btn primary" onClick={() => profileFileRef.current?.click()} disabled={busy}>
                {busy ? "Uploading…" : "Upload new photo"}
              </button>
            </div>
            <div className="modal-actions">
              <button className="te-btn" onClick={() => setProfileOpen(false)}>Done</button>
            </div>
            <input ref={profileFileRef} type="file" accept="image/*" hidden onChange={onPickProfileFile} />
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

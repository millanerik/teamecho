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
import { searchGifs, giphyConfigured } from "./giphy.js";

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
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Fira+Code:wght@400;500;600&display=swap');

/* kill the browser's default white margin around the page */
html, body, #root { margin:0; padding:0; min-height:100%; }
body { background:#262A31; }

:root{
  --font:'Plus Jakarta Sans',ui-sans-serif,system-ui,sans-serif;
  --font-mono:'Fira Code',ui-monospace,monospace;
  /* small accent palette (tags, priority chips) */
  --green:#4CD97B; --orange:#F5A54A; --red:#F4586F; --blue:#4B9BFF; --pink:#E667A9;
}
[data-theme="dark"]{
  --page:#262A31;                 /* dark slate grey main background */
  --panel:#121418;                /* sidebar / topbar / board surface */
  --card:#1A1D23;                 /* raised cards, inputs, stickers */
  --card-2:#20242B;
  --border:rgba(255,255,255,.06);
  --border-strong:rgba(255,255,255,.12);
  --ink:#F2F3F5; --ink-soft:#A6AAB2; --ink-faint:#8B8F98;
  --accent:#341539;               /* main accent */
  --accent-hover:#431C4A;
  --accent-edge:#5C2B66;
  --accent-ink:#EBD3F4;           /* text on accent */
  --accent-bright:#C77FDE;        /* accent-colored text on dark */
  --pill-bg:#FFFFFF; --pill-ink:#111216;   /* active nav pill */
  --canvas-dot:rgba(255,255,255,.05);
  --shadow:0 12px 32px rgba(0,0,0,.45);
  --sticker-shadow:0 10px 24px rgba(0,0,0,.5);
}
[data-theme="light"]{
  --page:#E8EAEE;
  --panel:#FFFFFF;
  --card:#F4F5F7;
  --card-2:#EBEDF1;
  --border:rgba(17,18,22,.08);
  --border-strong:rgba(17,18,22,.16);
  --ink:#16171B; --ink-soft:#565A61; --ink-faint:#7E848D;
  --accent:#341539;
  --accent-hover:#431C4A;
  --accent-edge:#5C2B66;
  --accent-ink:#F2E3F7;
  --accent-bright:#7A3B8C;
  --pill-bg:#16171B; --pill-ink:#FFFFFF;
  --canvas-dot:rgba(17,18,22,.07);
  --shadow:0 10px 28px rgba(24,20,34,.12);
  --sticker-shadow:0 8px 20px rgba(24,20,34,.14);
}

.te-root{
  font-family:var(--font);
  color:var(--ink);
  min-height:100vh;
  background:var(--page);
  transition:background .3s ease, color .3s ease;
}
.te-root *{box-sizing:border-box}
.te-root button{font-family:inherit; cursor:pointer}
.te-root button:focus-visible, .te-root input:focus-visible, .te-root select:focus-visible, .te-root textarea:focus-visible{
  outline:2px solid var(--accent-bright); outline-offset:2px; border-radius:8px;
}

/* ---------- wordmark (flat, professional) ---------- */
.echo-stack{position:relative; display:grid; place-items:center; user-select:none; pointer-events:none; z-index:1;}
.echo-stack span{grid-area:1/1; font-weight:800; letter-spacing:-.03em; white-space:nowrap; line-height:1;}
.echo-ring{display:none;}
.echo-core{
  background:linear-gradient(100deg, var(--ink) 45%, var(--accent-bright));
  -webkit-background-clip:text; background-clip:text; color:transparent;
}

/* ---------- shared bits ---------- */
.te-btn{
  border:1px solid var(--border-strong); background:var(--card); color:var(--ink);
  border-radius:999px; padding:9px 16px; font-size:13.5px; font-weight:600;
  cursor:pointer; display:inline-flex; align-items:center; gap:8px;
  transition:background .15s, border-color .15s, transform .1s;
}
.te-btn:hover{background:var(--card-2); border-color:var(--ink-faint)}
.te-btn.primary{
  border:1px solid var(--accent-edge); color:var(--accent-ink); background:var(--accent);
}
.te-btn.primary:hover{background:var(--accent-hover)}
.te-btn.icon{padding:9px; border-radius:999px}
.icon-circle{
  width:38px; height:38px; border-radius:50%; border:1px solid var(--border-strong);
  background:var(--card); color:var(--ink); display:grid; place-items:center; cursor:pointer;
  transition:background .15s, border-color .15s; flex:none;
}
.icon-circle:hover{background:var(--card-2)}
.te-input{
  width:100%; border:1px solid var(--border-strong); background:var(--card);
  color:var(--ink); border-radius:14px; padding:11px 14px; font-size:13.5px;
  transition:border-color .15s;
}
.te-input:focus{outline:none; border-color:var(--accent-bright)}
.te-input::placeholder{color:var(--ink-faint)}
.avatar{
  border-radius:50%; overflow:hidden; flex:none;
  display:grid; place-items:center;
  background:var(--accent); border:1px solid var(--accent-edge);
  color:var(--accent-ink); font-weight:700;
}
.avatar img{width:100%; height:100%; object-fit:cover}
.role-chip{
  font-family:var(--font-mono);
  font-size:9.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase;
  padding:3px 9px; border-radius:999px; border:1px solid var(--border-strong);
  color:var(--ink-soft); background:var(--card);
}
.role-chip.admin{
  color:var(--accent-ink); border-color:var(--accent-edge); background:var(--accent);
}

/* ---------- login ---------- */
.login-wrap{min-height:100vh; display:grid; place-items:center; padding:24px; position:relative;}
.bg-ripple{display:none;}
.login-panel{
  position:relative; z-index:1; width:min(560px,100%);
  background:var(--panel); border:1px solid var(--border); border-radius:24px;
  box-shadow:var(--shadow); padding:44px 40px 36px;
}
.login-sub{color:var(--ink-soft); font-size:13.5px; text-align:center; margin:12px 0 28px;}
.login-form{max-width:340px; margin:0 auto; display:flex; flex-direction:column; gap:14px;}
.field-label{font-family:var(--font-mono); font-size:10.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-soft); margin-bottom:7px; display:block}
.select-wrap{position:relative}
.select-wrap svg{position:absolute; right:14px; top:50%; transform:translateY(-50%); pointer-events:none; color:var(--ink-faint)}
.te-select{
  width:100%; border:1px solid var(--border-strong); background:var(--card);
  color:var(--ink); border-radius:14px; padding:12px 40px 12px 14px; font-size:13.5px;
  font-family:inherit; appearance:none; cursor:pointer; font-weight:500;
}
.te-select:invalid{color:var(--ink-faint)}
.selected-user{
  display:flex; align-items:center; gap:11px; padding:10px 12px;
  border:1px solid var(--border); background:var(--card); border-radius:16px;
}
.selected-user .nm{font-weight:700; font-size:13.5px; line-height:1.2; margin-bottom:3px}
.pin-boxes{display:flex; gap:10px; justify-content:center; margin:2px 0}
.pin-box{
  width:52px; height:58px; text-align:center; font-size:22px; font-weight:600;
  font-family:var(--font-mono); color:var(--ink);
  border:1px solid var(--border-strong); background:var(--card); border-radius:14px;
  transition:border-color .12s;
}
.pin-box:focus{outline:none; border-color:var(--accent-bright)}
.pin-box.filled{border-color:var(--accent-edge)}
.login-error{color:var(--red); font-size:12.5px; text-align:center}
.login-note{font-size:12px; color:var(--ink-faint); text-align:center; line-height:1.5}

/* ---------- app shell ---------- */
.shell{display:flex; min-height:100vh; padding:14px; gap:14px}
.rail{
  width:236px; flex:none; display:flex; flex-direction:column; gap:2px;
  padding:20px 14px 14px; border:1px solid var(--border); border-radius:20px;
  background:var(--panel);
}
.rail .brand{display:flex; align-items:center; gap:11px; padding:2px 8px 22px}
.brand-mark{
  width:34px; height:34px; border-radius:50%; display:grid; place-items:center;
  background:var(--accent); border:1px solid var(--accent-edge);
  color:var(--accent-ink); font-weight:800; font-size:12.5px;
}
.brand-name{font-weight:800; font-size:16px; letter-spacing:-.02em}
.rail-label{font-family:var(--font-mono); font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-faint); padding:6px 12px 8px; font-weight:600}
.nav-item{
  display:flex; align-items:center; gap:11px; padding:11px 13px; border-radius:999px;
  border:none; background:transparent; color:var(--ink-soft); font-size:13.5px; font-weight:600;
  cursor:pointer; width:100%; text-align:left; transition:color .15s, background .15s;
}
.nav-item:not(.ghost):not(.active):hover{color:var(--ink); background:var(--card)}
.nav-item.active{
  color:var(--pill-ink); background:var(--pill-bg); font-weight:700;
}
.nav-item.ghost{color:var(--ink-faint); cursor:default}
.nav-badge{
  font-family:var(--font-mono);
  margin-left:auto; font-size:10px; font-weight:700; letter-spacing:.03em;
  padding:3px 8px; border-radius:999px; background:var(--card-2); color:var(--ink-faint);
  border:1px solid var(--border);
}
.theme-pill{
  display:flex; gap:4px; padding:4px; border:1px solid var(--border-strong);
  border-radius:999px; background:var(--card); width:max-content; margin:14px 0 12px 6px;
}
.theme-pill button{
  width:32px; height:32px; border-radius:50%; border:none; background:transparent;
  color:var(--ink-faint); display:grid; place-items:center; cursor:pointer;
  transition:background .15s, color .15s;
}
.theme-pill button.on{background:var(--pill-bg); color:var(--pill-ink)}
.rail-me{
  display:flex; align-items:center; gap:10px; padding:10px;
  border:1px solid var(--border); border-radius:16px; background:var(--card);
}
.rail-me .who{min-width:0; display:flex; flex-direction:column; gap:3px; align-items:flex-start}
.rail-me .who .n{font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:104px}
.rail-me .role-chip{white-space:nowrap}
.rail-spacer{margin-top:auto}

/* ---------- top bar + canvas ---------- */
.main{flex:1; display:flex; flex-direction:column; min-width:0; gap:14px}
.topbar{
  display:flex; align-items:center; gap:14px; padding:14px 20px;
  border:1px solid var(--border); border-radius:20px; background:var(--panel);
}
.page-title{font-weight:800; font-size:19px; letter-spacing:-.02em; line-height:1.2}
.page-sub{font-size:12px; color:var(--ink-faint); font-weight:500; margin-top:2px}
.search-pill{
  margin-left:auto; display:flex; align-items:center; gap:9px;
  border:1px solid var(--border-strong); background:var(--card); border-radius:999px;
  padding:9px 16px; width:min(260px, 30vw); color:var(--ink-faint);
}
.search-pill input{
  border:none; background:transparent; color:var(--ink); font-size:13px; font-family:inherit;
  width:100%; padding:0;
}
.search-pill input:focus{outline:none}
.search-pill input::placeholder{color:var(--ink-faint)}
.canvas{
  position:relative; flex:1; border-radius:20px; overflow:hidden;
  border:1px solid var(--border); background:var(--panel);
  min-height:520px;
}
.canvas::after{
  content:""; position:absolute; inset:0; pointer-events:none;
  background-image:radial-gradient(var(--canvas-dot) 1px, transparent 1px);
  background-size:24px 24px;
}
.canvas-center{position:absolute; inset:0; display:grid; place-items:center; z-index:1}

/* ---------- stickers ---------- */
.sticker{position:absolute; touch-action:none; cursor:grab; user-select:none; z-index:2;}
.sticker:focus-visible{outline:2px solid var(--accent-bright); outline-offset:3px; border-radius:16px;}
.sticker:focus-visible .meta{opacity:1}
@media (prefers-reduced-motion: reduce){
  .te-root *, .te-root *::before, .te-root *::after{transition-duration:.01ms !important; animation-duration:.01ms !important;}
}
.sticker.dragging{cursor:grabbing}
.sticker .inner{
  border-radius:14px; overflow:hidden; box-shadow:var(--sticker-shadow);
  border:1px solid var(--border-strong); background:var(--card);
  transition:transform .12s ease, border-color .12s;
}
.sticker:hover .inner{transform:scale(1.02); border-color:var(--ink-faint)}
.sticker img{display:block; width:100%; height:auto; pointer-events:none}
.sticker .note{
  padding:14px 16px; font-size:13px; line-height:1.5; font-weight:600;
  width:100%; height:100%; white-space:pre-wrap; word-break:break-word;
}
.sticker .meta{
  font-family:var(--font-mono);
  position:absolute; left:8px; bottom:-22px; font-size:10px; color:var(--ink-faint);
  opacity:0; transition:opacity .15s; white-space:nowrap; font-weight:600;
}
.sticker:hover .meta{opacity:1}
.sticker .del{
  position:absolute; top:-10px; right:-10px; width:24px; height:24px; border-radius:50%;
  border:1px solid var(--border-strong); background:var(--panel); color:var(--ink); font-size:13px; line-height:1;
  cursor:pointer; opacity:0; transition:opacity .15s; display:grid; place-items:center;
}
.sticker:hover .del{opacity:1}
.sticker .del:hover{background:var(--red); border-color:var(--red); color:#fff}

/* ---------- add button / menus / modals ---------- */
.fab{
  position:absolute; right:20px; bottom:20px; height:46px; padding:0 20px 0 16px;
  border-radius:999px; border:1px solid var(--accent-edge); color:var(--accent-ink);
  font-size:13.5px; font-weight:700; cursor:pointer; z-index:5;
  background:var(--accent); display:inline-flex; align-items:center; gap:8px;
  box-shadow:var(--shadow); transition:background .15s, transform .1s;
}
.fab:hover{background:var(--accent-hover); transform:translateY(-1px)}
.fab .plus{font-size:18px; font-weight:600; line-height:1}
.add-menu{
  position:absolute; right:20px; bottom:76px; width:232px; padding:8px;
  background:var(--card); border:1px solid var(--border-strong); border-radius:16px;
  box-shadow:var(--shadow); display:flex; flex-direction:column; gap:2px; z-index:6;
}
.add-menu button{
  display:flex; align-items:center; gap:10px; padding:11px 12px; border-radius:12px;
  border:none; background:transparent; color:var(--ink); font-size:13px; font-weight:600;
  cursor:pointer; text-align:left; width:100%; transition:background .15s;
}
.add-menu button:hover{background:var(--card-2)}
.overlay{
  position:fixed; inset:0; background:rgba(10,11,14,.6); z-index:80;
  display:grid; place-items:center; padding:20px;
}
.modal{
  width:min(420px,100%); background:var(--panel); border:1px solid var(--border-strong);
  border-radius:20px; box-shadow:var(--shadow); padding:24px;
}
.modal h3{margin:0 0 4px; font-size:16.5px; font-weight:800; letter-spacing:-.01em}
.modal p.sub{margin:0 0 16px; font-size:12.5px; color:var(--ink-soft)}
.swatches{display:flex; gap:8px; margin:12px 0 16px}
.swatch{width:28px; height:28px; border-radius:50%; cursor:pointer; border:2px solid transparent; transition:transform .12s}
.swatch.sel{border-color:var(--ink); transform:scale(1.12)}
.modal-actions{display:flex; justify-content:flex-end; gap:8px; margin-top:6px}
.toast{
  position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
  background:var(--card); color:var(--ink); border:1px solid var(--border-strong);
  font-size:13px; font-weight:600;
  padding:11px 18px; border-radius:999px; z-index:100; box-shadow:var(--shadow);
}
.spinner{
  width:22px; height:22px; border-radius:50%; border:3px solid var(--border-strong);
  border-top-color:var(--accent-bright); animation:te-spin .8s linear infinite;
}
@keyframes te-spin{to{transform:rotate(360deg)}}
.sticker.selected .inner{border-color:var(--accent-bright); box-shadow:0 0 0 1.5px var(--accent-bright), var(--sticker-shadow);}

/* free-transform handles (Photoshop style) */
.tf-handle{
  position:absolute; width:14px; height:14px; border-radius:3px;
  background:var(--panel); border:1.5px solid var(--accent-bright);
  box-shadow:0 1px 4px rgba(0,0,0,.4); z-index:3; touch-action:none;
}
.tf-handle:hover{background:var(--accent-bright)}
.tf-stem{
  position:absolute; left:50%; top:-26px; width:1.5px; height:26px;
  background:var(--accent-bright); translate:-50% 0; z-index:2; pointer-events:none;
}
.tf-rotate{
  position:absolute; left:50%; top:-40px; translate:-50% 0;
  width:26px; height:26px; border-radius:50%;
  background:var(--panel); border:1.5px solid var(--accent-bright); color:var(--accent-bright);
  display:grid; place-items:center; cursor:grab; z-index:3; touch-action:none;
  box-shadow:0 2px 6px rgba(0,0,0,.4);
}
.tf-rotate:hover{background:var(--accent-bright); color:#fff}
.tf-rotate:active{cursor:grabbing}
.tf-reset{
  position:absolute; right:-14px; bottom:-40px;
  width:28px; height:28px; border-radius:50%;
  background:var(--panel); border:1px solid var(--border-strong); color:var(--ink);
  display:grid; place-items:center; cursor:pointer; z-index:3;
  box-shadow:var(--shadow); transition:background .15s;
}
.tf-reset:hover{background:var(--card-2)}

/* ---------- GIF picker ---------- */
.gif-modal{width:min(560px,100%)}
.gif-head{display:flex; align-items:center; justify-content:space-between; margin-bottom:14px}
.gif-head h3{margin:0}
.gif-search{display:flex; gap:8px; margin-bottom:14px}
.gif-grid{
  display:grid; grid-template-columns:repeat(3,1fr); gap:8px;
  max-height:340px; overflow-y:auto; padding:2px; margin:0 -2px;
}
.gif-cell{
  border:1px solid var(--border); border-radius:12px; overflow:hidden; cursor:pointer;
  background:var(--card); padding:0; aspect-ratio:1; transition:border-color .15s, transform .1s;
}
.gif-cell:hover{border-color:var(--accent-bright); transform:scale(1.03)}
.gif-cell img{width:100%; height:100%; object-fit:cover; display:block}
.gif-empty{
  grid-column:1 / -1; display:grid; place-items:center; min-height:160px;
  color:var(--ink-faint); font-size:13px; text-align:center;
}
.gif-foot{font-family:var(--font-mono); font-size:10px; color:var(--ink-faint); text-align:right; margin-top:12px; letter-spacing:.04em}
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

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

// Circular single-icon toggle (used on the login screen)
function ThemeToggle({ theme, onToggle }) {
  return (
    <button
      className="icon-circle"
      onClick={onToggle}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      {theme === "light" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

// Moon/sun pill (bottom of the sidebar, like the reference)
function ThemePill({ theme, setTheme }) {
  return (
    <div className="theme-pill" role="group" aria-label="Color theme">
      <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")} aria-label="Dark mode" title="Dark mode">
        <MoonIcon />
      </button>
      <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")} aria-label="Light mode" title="Light mode">
        <SunIcon />
      </button>
    </div>
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
  // GIF picker
  const [gifOpen, setGifOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifError, setGifError] = useState("");
  // currently selected pin (shows resize/rotate toolbar); null = none
  const [selectedId, setSelectedId] = useState(null);
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
    setThemePersist(next);
  };

  const setThemePersist = (next) => {
    setTheme(next);
    try { localStorage.setItem("te-theme", next); } catch {}
  };

  const [query, setQuery] = useState(""); // topbar search: filters board pins

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
    if (selectedId === item.id) setSelectedId(null);
    try {
      await deleteBoardItem(item.id);
    } catch (e) {
      console.error(e);
      say("Couldn't remove that pin.");
    }
  };

  /* ---------- resize & rotate (all pins: images, gifs, notes) ---------- */
  const MIN_W = 90;    // px — keep pins from vanishing
  const MAX_W = 340;   // px — "nothing too big": ~a third of a typical board

  const clampW = (w) => Math.max(MIN_W, Math.min(MAX_W, Math.round(w)));

  // Persist size/rotation, debounced so we don't spam the DB while dragging.
  const persistTimer = useRef(null);
  const persistPin = (id, patch) => {
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      updateBoardItem(id, patch).catch(console.error);
    }, 400);
  };

  // keyboard nudge helpers (used by the accessibility path)
  const resizePin = (item, deltaW) => {
    const next = clampW(item.w + deltaW);
    if (next === item.w) return;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, w: next } : i)));
    persistPin(item.id, { w: next });
  };
  const rotatePin = (item, deltaDeg) => {
    const next = Math.round((item.rot + deltaDeg) * 10) / 10;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, rot: next } : i)));
    persistPin(item.id, { rot: next });
  };
  const resetPin = (item) => {
    const w = item.type === "text" ? 190 : 180;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, w, rot: 0 } : i)));
    persistPin(item.id, { w, rot: 0 });
  };

  /* ---------- free-transform via corner handles (Photoshop-style) ---------- */
  const transformRef = useRef(null);

  // Center of the pin's rendered box, in canvas pixels.
  const pinCenterPx = (item, canvasRect) => {
    const el = document.querySelector(`[data-pin="${item.id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      cx: r.left + r.width / 2 - canvasRect.left,
      cy: r.top + r.height / 2 - canvasRect.top,
    };
  };

  const onHandleDown = (e, item, mode) => {
    e.stopPropagation();
    e.preventDefault();
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const center = pinCenterPx(item, canvasRect);
    if (!center) return;
    const px = e.clientX - canvasRect.left;
    const py = e.clientY - canvasRect.top;
    const startAngle = Math.atan2(py - center.cy, px - center.cx) * (180 / Math.PI);
    const startDist = Math.hypot(px - center.cx, py - center.cy);
    // bring to front while transforming
    const newZ = zRef.current++;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, z: newZ } : i)));
    transformRef.current = {
      id: item.id,
      mode,                         // "resize" | "rotate"
      canvasRect,
      center,
      startAngle,
      startRot: item.rot,
      startDist: startDist || 1,
      startW: item.w,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onHandleMove = (e) => {
    const t = transformRef.current;
    if (!t) return;
    const px = e.clientX - t.canvasRect.left;
    const py = e.clientY - t.canvasRect.top;

    if (t.mode === "rotate") {
      const ang = Math.atan2(py - t.center.cy, px - t.center.cx) * (180 / Math.PI);
      let next = Math.round((t.startRot + (ang - t.startAngle)) * 10) / 10;
      // normalise to -180..180 for tidy stored values
      while (next > 180) next -= 360;
      while (next < -180) next += 360;
      setItems((prev) => prev.map((i) => (i.id === t.id ? { ...i, rot: next } : i)));
    } else {
      const dist = Math.hypot(px - t.center.cx, py - t.center.cy);
      const next = clampW((t.startW * dist) / t.startDist);
      setItems((prev) => prev.map((i) => (i.id === t.id ? { ...i, w: next } : i)));
    }
  };

  const onHandleUp = () => {
    const t = transformRef.current;
    transformRef.current = null;
    if (!t) return;
    setItems((prev) => {
      const it = prev.find((i) => i.id === t.id);
      if (it) persistPin(it.id, { w: it.w, rot: it.rot, z: it.z });
      return prev;
    });
  };

  /* ---------- GIF picker ---------- */
  const runGifSearch = async (q) => {
    setGifLoading(true);
    setGifError("");
    try {
      setGifResults(await searchGifs(q));
    } catch (e) {
      console.error(e);
      setGifError(giphyConfigured ? "Couldn't load GIFs. Try again." : "GIF search isn't set up yet.");
      setGifResults([]);
    }
    setGifLoading(false);
  };

  const openGifPicker = () => {
    setAddOpen(false);
    setGifOpen(true);
    setGifQuery("");
    if (giphyConfigured) runGifSearch(""); // trending on open
    else setGifError("GIF search isn't set up yet.");
  };

  const pinGif = async (gif) => {
    setGifOpen(false);
    await addItem({ type: "gif", src: gif.fullUrl, w: 200 });
  };

  /* ---------- drag & drop ---------- */
  const onStickerDown = (e, item) => {
    if (e.target.closest(".del, .tf-handle, .tf-rotate, .tf-reset")) return;
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

  // WCAG 2.2 dragging-alternative: arrow keys move a focused pin (Shift = larger
  // steps), Delete/Backspace removes it. Position saves after a short pause.
  const keySaveTimer = useRef(null);
  const onStickerKeyDown = (e, item) => {
    const step = e.shiftKey ? 4 : 1;
    let dx = 0, dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    else if ((e.key === "Delete" || e.key === "Backspace") && (isAdmin || item.owner === me.id)) {
      e.preventDefault();
      removeItem(item);
      return;
    }
    // resize / rotate for any pin you can edit
    else if (isAdmin || item.owner === me.id) {
      if (e.key === "+" || e.key === "=") { e.preventDefault(); resizePin(item, 24); return; }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); resizePin(item, -24); return; }
      if (e.key === "[") { e.preventDefault(); rotatePin(item, -15); return; }
      if (e.key === "]") { e.preventDefault(); rotatePin(item, 15); return; }
      return;
    } else return;
    e.preventDefault();
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? { ...i, x: Math.min(96, Math.max(-4, i.x + dx)), y: Math.min(96, Math.max(-2, i.y + dy)) }
          : i
      )
    );
    clearTimeout(keySaveTimer.current);
    keySaveTimer.current = setTimeout(() => {
      setItems((prev) => {
        const it = prev.find((i) => i.id === item.id);
        if (it) updateBoardItem(it.id, { x: it.x, y: it.y, z: it.z }).catch(console.error);
        return prev;
      });
    }, 600);
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

          <div className="rail-label">Main menu</div>
          <button className="nav-item active">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" />
            </svg>
            <span className="lbl">Home</span>
          </button>
          {[
            ["Meet The Team", <g key="team"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.9" /><path d="M17 14.4a5.5 5.5 0 0 1 3.5 5.1" /></g>],
            ["Huddle Metrics", <g key="metrics"><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></g>],
            ["Echo Chamber", <g key="echo"><path d="M7.5 15H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v.5" /><path d="M21 14a3 3 0 0 0-3-3h-6a3 3 0 0 0-3 3v2a3 3 0 0 0 3 3h.5l-.5 2.5L17.5 19H18a3 3 0 0 0 3-3z" /></g>],
          ].map(([name, icon]) => (
            <div key={name} className="nav-item ghost">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {icon}
              </svg>
              <span className="lbl">{name}</span>
              <span className="nav-badge">soon</span>
            </div>
          ))}

          <div className="rail-spacer" />
          <ThemePill theme={theme} setTheme={setThemePersist} />
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
              className="icon-circle"
              style={{ marginLeft: "auto", width: 32, height: 32 }}
              onClick={() => setMe(null)}
              title="Log out"
              aria-label="Log out"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
              </svg>
            </button>
          </div>
        </aside>

        {/* main column */}
        <div className="main">
          <div className="topbar">
            <div>
              <div className="page-title">Welcome back, {me.name.split(" ")[0]} 👋</div>
              <div className="page-sub">Drag pins — or focus one and use arrow keys</div>
            </div>
            <div className="search-pill">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                placeholder="Search pins…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search pins by text or teammate"
              />
            </div>
            <button
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
              onClick={() => setProfileOpen(true)}
              title="Profile photo"
              aria-label="Profile photo"
            >
              <Avatar user={me} size={38} />
            </button>
          </div>

          <div className="canvas" ref={canvasRef}>
            <div className="canvas-center">
              <EchoWordmark size={Math.min(84, (typeof window !== "undefined" ? window.innerWidth : 1200) / 12)} />
            </div>

            {loadingBoard && (
              <div style={{ position: "absolute", top: 14, left: 14 }}><div className="spinner" /></div>
            )}

            {items
              .filter((item) => {
                const q = query.trim().toLowerCase();
                if (!q) return true;
                return (
                  (item.text || "").toLowerCase().includes(q) ||
                  (item.ownerName || "").toLowerCase().includes(q)
                );
              })
              .map((item) => {
              const canEdit = isAdmin || item.owner === me.id;
              const noteC = NOTE_COLORS.find((c) => c.id === item.color) || NOTE_COLORS[0];
              const isSelected = selectedId === item.id;
              return (
                <div
                  key={item.id}
                  data-pin={item.id}
                  className={`sticker ${dragRef.current?.id === item.id ? "dragging" : ""} ${isSelected ? "selected" : ""}`}
                  style={{
                    left: `${item.x}%`,
                    top: `${item.y}%`,
                    width: item.w,
                    zIndex: isSelected ? 999 : item.z || 1,
                    transform: `rotate(${item.rot}deg)`,
                  }}
                  tabIndex={0}
                  role="group"
                  aria-label={`${item.type === "text" ? "Note" : "Image"} pinned by ${item.ownerName}. Arrow keys move${canEdit ? ", plus and minus resize, brackets rotate" : ""}, Delete removes.`}
                  onKeyDown={(e) => onStickerKeyDown(e, item)}
                  onPointerDown={(e) => onStickerDown(e, item)}
                  onPointerMove={onStickerMove}
                  onPointerUp={onStickerUp}
                  onPointerCancel={onStickerUp}
                  onClick={() => canEdit && setSelectedId(isSelected ? null : item.id)}
                >
                  <div
                    className="inner"
                    style={
                      item.type === "text"
                        ? theme === "dark"
                          ? { background: `${noteC.dark}66`, borderColor: `${noteC.dark}`, minHeight: 64 }
                          : { background: noteC.light, borderColor: noteC.dark + "55", minHeight: 64 }
                        : {}
                    }
                  >
                    {item.type === "text" ? (
                      <div className="note" style={{ color: theme === "dark" ? noteC.light : "#26213A" }}>{item.text}</div>
                    ) : (
                      <img src={item.src} alt={`Pinned by ${item.ownerName}`} draggable={false} />
                    )}
                  </div>
                  <div className="meta">pinned by {item.owner === me.id ? "you" : item.ownerName}</div>
                  {canEdit && (
                    <button className="del" onClick={(e) => { e.stopPropagation(); removeItem(item); }} aria-label="Remove pin">×</button>
                  )}

                  {/* Photoshop-style free transform — shown when selected */}
                  {isSelected && canEdit && (
                    <>
                      {/* four corner resize handles */}
                      {[
                        ["nw", { top: -7, left: -7, cursor: "nwse-resize" }],
                        ["ne", { top: -7, right: -7, cursor: "nesw-resize" }],
                        ["se", { bottom: -7, right: -7, cursor: "nwse-resize" }],
                        ["sw", { bottom: -7, left: -7, cursor: "nesw-resize" }],
                      ].map(([corner, pos]) => (
                        <span
                          key={corner}
                          className="tf-handle"
                          style={pos}
                          onPointerDown={(e) => onHandleDown(e, item, "resize")}
                          onPointerMove={onHandleMove}
                          onPointerUp={onHandleUp}
                          onPointerCancel={onHandleUp}
                          onClick={(e) => e.stopPropagation()}
                          aria-hidden="true"
                        />
                      ))}
                      {/* rotation handle on a stem above the top edge */}
                      <span className="tf-stem" aria-hidden="true" />
                      <span
                        className="tf-rotate"
                        onPointerDown={(e) => onHandleDown(e, item, "rotate")}
                        onPointerMove={onHandleMove}
                        onPointerUp={onHandleUp}
                        onPointerCancel={onHandleUp}
                        onClick={(e) => e.stopPropagation()}
                        title="Drag to rotate"
                        aria-hidden="true"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
                        </svg>
                      </span>
                      {/* small reset control, counter-rotated to stay upright */}
                      <button
                        className="tf-reset"
                        style={{ transform: `rotate(${-item.rot}deg)` }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); resetPin(item); }}
                        title="Reset size & rotation"
                        aria-label="Reset size and rotation"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 1 9 9" /><path d="M3 12v-5" /><path d="M3 12h5" /></svg>
                      </button>
                    </>
                  )}
                </div>
              );
            })}

            {/* add button + menu */}
            <button className="fab" onClick={() => setAddOpen((v) => !v)} aria-label="Add to the board">
              <span className="plus">{addOpen ? "×" : "+"}</span>
              <span>{addOpen ? "Close" : "Add pin"}</span>
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
                <button onClick={openGifPicker}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M8.5 9.5v5M8.5 9.5H7m9 0h-3v5m3-2.5h-2" />
                  </svg>
                  Search GIFs
                </button>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickBoardFile} />
          </div>
        </div>
      </div>

      {/* GIF picker modal */}
      {gifOpen && (
        <div className="overlay" onClick={() => setGifOpen(false)}>
          <div className="modal gif-modal" onClick={(e) => e.stopPropagation()}>
            <div className="gif-head">
              <h3>Search GIFs</h3>
              <button className="icon-circle" style={{ width: 32, height: 32 }} onClick={() => setGifOpen(false)} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <form
              className="gif-search"
              onSubmit={(e) => { e.preventDefault(); if (giphyConfigured) runGifSearch(gifQuery); }}
            >
              <div className="search-pill" style={{ width: "100%", marginLeft: 0 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  autoFocus
                  placeholder="Search GIPHY…"
                  value={gifQuery}
                  onChange={(e) => setGifQuery(e.target.value)}
                  aria-label="Search GIPHY for GIFs"
                />
              </div>
              <button type="submit" className="te-btn primary" disabled={!giphyConfigured || gifLoading}>
                {gifLoading ? "…" : "Search"}
              </button>
            </form>

            <div className="gif-grid">
              {gifError && <div className="gif-empty">{gifError}</div>}
              {!gifError && gifLoading && <div className="gif-empty"><div className="spinner" /></div>}
              {!gifError && !gifLoading && gifResults.length === 0 && (
                <div className="gif-empty">No GIFs found. Try another search.</div>
              )}
              {!gifLoading &&
                gifResults.map((g) => (
                  <button key={g.id} className="gif-cell" onClick={() => pinGif(g)} title={g.title} aria-label={`Pin GIF: ${g.title}`}>
                    <img src={g.previewUrl} alt={g.title} loading="lazy" />
                  </button>
                ))}
            </div>
            <div className="gif-foot">Powered by GIPHY</div>
          </div>
        </div>
      )}

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

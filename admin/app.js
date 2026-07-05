import { signIn, signOut, getSessionRole } from './supabase-client.js';
import { initContext, onContextChange, setContextMode } from './context.js';
import { loading } from './ui.js';

const screens = new Map();
let currentRole = null;
let currentScreen = null;

export function registerScreen(name, { render, context = 'category' }) {
  screens.set(name, { render, context });
}

export async function showScreen(name) {
  const screen = screens.get(name);
  if (!screen) throw new Error(`Unknown screen: ${name}`);
  currentScreen = name;
  setContextMode(screen.context);
  const main = document.getElementById('main');
  main.innerHTML = loading();
  await screen.render(main, { role: currentRole });
  document.querySelectorAll('#nav button').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.screen === name);
  });
}

function renderNav() {
  const nav = document.getElementById('nav');
  const items = [
    ['tournaments', 'Turnier'],
    ['categories', 'Kategorien'],
    ['courts', 'Courts'],
    ['teams', 'Teams'],
    ['players', 'Kader'],
    ['matches', 'Matches'],
    ['schedule', 'Spielplan'],
    ['referees', 'Schiedsrichter'],
    ['game-report', 'Game Report'],
  ];
  nav.innerHTML = items.map(([key, label]) =>
    `<button class="pill" data-screen="${key}">${label}</button>`).join('');
  nav.querySelectorAll('button[data-screen]').forEach((b) => {
    b.onclick = () => showScreen(b.dataset.screen);
  });
}

async function boot() {
  const role = await getSessionRole();
  currentRole = role;
  const loginView = document.getElementById('loginView');
  const appView = document.getElementById('appView');

  if (!role) {
    loginView.hidden = false;
    appView.hidden = true;
    const form = document.getElementById('loginForm');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const error = await signIn(email, password);
      const errorEl = document.getElementById('loginError');
      if (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
        return;
      }
      location.reload();
    };
    return;
  }

  loginView.hidden = true;
  appView.hidden = false;
  renderNav();
  document.getElementById('roleLabel').textContent = `Angemeldet als: ${role}`;
  document.getElementById('logoutBtn').onclick = async () => {
    await signOut();
    location.reload();
  };
  await initContext();
  onContextChange(() => { if (currentScreen) showScreen(currentScreen); });
  await showScreen('tournaments');
}

boot();

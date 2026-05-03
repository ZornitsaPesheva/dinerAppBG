const form = document.querySelector('#dish-form');
const nameInput = document.querySelector('#dish-name');
const notesInput = document.querySelector('#dish-notes');
const messageElement = document.querySelector('#form-message');
const dishesContainer = document.querySelector('#dishes');
const suggestionsContainer = document.querySelector('#suggestions');
const refreshButton = document.querySelector('#refresh-button');
const dishTemplate = document.querySelector('#dish-template');
const suggestionTemplate = document.querySelector('#suggestion-template');
const appShell = document.querySelector('#app-shell');
const authMessageElement = document.querySelector('#auth-message');
const googleSigninContainer = document.querySelector('#google-signin');
const authUserElement = document.querySelector('#auth-user');
const mobileAuthSlot = document.querySelector('#mobile-auth-slot');
const userAvatarElement = document.querySelector('#user-avatar');
const userNameElement = document.querySelector('#user-name');
const userEmailElement = document.querySelector('#user-email');
const logoutButton = document.querySelector('#logout-button');
const authIntroElement = document.querySelector('#auth-intro');
const authPanelElement = document.querySelector('.auth-panel');
const demoBannerElement = document.querySelector('#demo-banner');
const tryDemoButton = document.querySelector('#try-demo-button');
const exitDemoButton = document.querySelector('#exit-demo-button');

const DEMO_STORAGE_KEY = 'diner_demo_dishes';

function getDemoDishes() {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDemoDishes(dishes) {
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(dishes));
}

function clearDemoData() {
  localStorage.removeItem(DEMO_STORAGE_KEY);
}

function localBuildApiResponse(dishes) {
  const normalized = dishes.map(d => ({
    id: d.id,
    name: d.name,
    notes: d.notes || '',
    cookCount: d.cookCount || 0,
    lastCookedAt: d.lastCookedAt || null,
    cookHistory: Array.isArray(d.cookHistory) ? d.cookHistory : []
  }));

  const byOldest = [...normalized].sort((a, b) => {
    const aNever = a.cookCount === 0 ? 0 : 1;
    const bNever = b.cookCount === 0 ? 0 : 1;
    if (aNever !== bNever) return aNever - bNever;
    const aLast = a.lastCookedAt || '0000-00-00';
    const bLast = b.lastCookedAt || '0000-00-00';
    if (aLast !== bLast) return aLast.localeCompare(bLast);
    if (a.cookCount !== b.cookCount) return a.cookCount - b.cookCount;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  const byRarest = [...normalized].sort((a, b) => {
    if (a.cookCount !== b.cookCount) return a.cookCount - b.cookCount;
    const aLast = a.lastCookedAt || '0000-00-00';
    const bLast = b.lastCookedAt || '0000-00-00';
    if (aLast !== bLast) return aLast.localeCompare(bLast);
    return a.name.localeCompare(b.name);
  });

  const oldest = byOldest[0];
  const rarest = byRarest.find(d => !oldest || d.id !== oldest.id);
  return { dishes: normalized, suggestions: [oldest, rarest].filter(Boolean) };
}

const state = {
  googleClientId: '',
  user: null,
  demoMode: false
};

let googleButtonInitialized = false;
const mobileMediaQuery = window.matchMedia('(max-width: 800px)');

function syncAuthPlacement() {
  const isAuthenticated = Boolean(state.user);
  const isMobile = mobileMediaQuery.matches;

  if (isAuthenticated && isMobile) {
    mobileAuthSlot.hidden = false;
    mobileAuthSlot.appendChild(authUserElement);
    authPanelElement.hidden = true;
    return;
  }

  mobileAuthSlot.hidden = true;
  googleSigninContainer.before(authUserElement);
  authPanelElement.hidden = false;
}

function getFallbackAvatarDataUri(name = '') {
  const firstLetter = (name || 'U').trim().charAt(0).toUpperCase() || 'U';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#d9b79f"/><text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" font-family="Georgia, serif" font-size="30" fill="#5b3a24">${firstLetter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });

  const payload = await response.json();

  if (!response.ok) {
    const error = new Error(payload.error || 'Request failed.');
    error.status = response.status;
    throw error;
  }

  return payload;
}

function formatDate(dateString) {
  if (!dateString) {
    return 'Все още не е приготвено';
  }

  return new Intl.DateTimeFormat('bg-BG', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(dateString));
}

function setMessage(text, type = '') {
  messageElement.textContent = text;
  messageElement.className = `message ${type}`.trim();
}

function setAuthMessage(text, type = '') {
  authMessageElement.textContent = text;
  authMessageElement.className = `message ${type}`.trim();
}

function setAppVisibility(isVisible) {
  appShell.hidden = !isVisible;
}

function clearDishUi() {
  suggestionsContainer.innerHTML = '';
  dishesContainer.innerHTML = '';
  setMessage('');
}

function renderGoogleButton() {
  if (!state.googleClientId) {
    googleSigninContainer.innerHTML = '<p class="message error">GOOGLE_CLIENT_ID липсва на сървъра.</p>';
    return;
  }

  if (!window.google || !window.google.accounts?.id) {
    googleSigninContainer.innerHTML = '<p class="message">Зареждане на Google вход...</p>';
    window.setTimeout(() => {
      if (!state.user) {
        renderAuthState();
      }
    }, 300);
    return;
  }

  if (!googleButtonInitialized) {
    window.google.accounts.id.initialize({
      client_id: state.googleClientId,
      callback: handleGoogleCredentialResponse
    });
    googleButtonInitialized = true;
  }

  googleSigninContainer.innerHTML = '';
  window.google.accounts.id.renderButton(googleSigninContainer, {
    theme: 'outline',
    size: 'large',
    shape: 'pill',
    text: 'signin_with',
    locale: 'bg'
  });
}

function renderAuthState() {
  const isAuthenticated = Boolean(state.user);

  authIntroElement.hidden = isAuthenticated;
  authMessageElement.hidden = isAuthenticated;
  logoutButton.hidden = !isAuthenticated;
  authUserElement.hidden = !isAuthenticated;
  googleSigninContainer.hidden = isAuthenticated;

  syncAuthPlacement();

  if (isAuthenticated) {
    userNameElement.textContent = state.user.name || 'Google user';
    userEmailElement.textContent = state.user.email || '';

    const fallbackAvatar = getFallbackAvatarDataUri(state.user.name || state.user.email || 'Google');
    userAvatarElement.src = state.user.picture || fallbackAvatar;
    userAvatarElement.hidden = false;
    userAvatarElement.onerror = () => {
      userAvatarElement.onerror = null;
      userAvatarElement.src = fallbackAvatar;
    };

    setAuthMessage('');
    return;
  }

  userNameElement.textContent = '';
  userEmailElement.textContent = '';
  userAvatarElement.hidden = true;
  userAvatarElement.removeAttribute('src');
  renderGoogleButton();
}

function bindViewportListener() {
  const handleViewportChange = () => {
    syncAuthPlacement();
  };

  if (mobileMediaQuery.addEventListener) {
    mobileMediaQuery.addEventListener('change', handleViewportChange);
    return;
  }

  mobileMediaQuery.addListener(handleViewportChange);
}

async function resetSession(message = '', type = '') {
  state.user = null;
  setAppVisibility(false);
  clearDishUi();
  renderAuthState();
  setAuthMessage(message, type);
}

function renderSuggestions(suggestions) {
  suggestionsContainer.innerHTML = '';

  if (suggestions.length === 0) {
    suggestionsContainer.innerHTML = '<div class="empty-state">Добавете рецепти, за да видите препоръки.</div>';
    return;
  }

  const labels = ['1. Най-дълго без готвене', '2. Най-рядко приготвяно'];

  suggestions.forEach((dish, index) => {
    const fragment = suggestionTemplate.content.cloneNode(true);
    fragment.querySelector('.suggestion-label').textContent = labels[index] || 'Препоръка';
    fragment.querySelector('.suggestion-name').textContent = dish.name;
    fragment.querySelector('.suggestion-meta').textContent =
      `${dish.cookCount} пъти приготвено • Последно: ${formatDate(dish.lastCookedAt)}`;
    fragment.querySelector('.cook-button').addEventListener('click', async () => {
      await cookDish(dish.id);
    });
    suggestionsContainer.appendChild(fragment);
  });
}

async function cookDish(dishId) {
  if (state.demoMode) {
    const dishes = getDemoDishes();
    const dish = dishes.find(d => d.id === dishId);
    if (!dish) return;
    const cookedAt = new Date().toISOString();
    if (!Array.isArray(dish.cookHistory)) dish.cookHistory = [];
    dish.cookHistory.push(cookedAt);
    dish.cookCount = dish.cookHistory.length;
    dish.lastCookedAt = cookedAt;
    saveDemoDishes(dishes);
    const result = localBuildApiResponse(dishes);
    renderSuggestions(result.suggestions);
    renderDishes(result.dishes);
    return;
  }

  try {
    const data = await requestJson(`/api/dishes/${dishId}/cook`, { method: 'POST' });
    renderSuggestions(data.suggestions);
    renderDishes(data.dishes);
  } catch (error) {
    if (error.status === 401) {
      await resetSession('Сесията ви изтече. Моля, влезте отново с Google.', 'error');
      return;
    }

    setMessage(error.message, 'error');
  }
}

function renderDishes(dishes) {
  dishesContainer.innerHTML = '';

  if (dishes.length === 0) {
    dishesContainer.innerHTML = '<div class="empty-state">Списъкът е празен. Добавете първата си рецепта.</div>';
    return;
  }

  dishes
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    .forEach(dish => {
      const fragment = dishTemplate.content.cloneNode(true);
      fragment.querySelector('.dish-name').textContent = dish.name;
      fragment.querySelector('.dish-notes').textContent = dish.notes || 'Без бележки.';
      fragment.querySelector('.count-pill').textContent = `Приготвено ${dish.cookCount} пъти`;
      fragment.querySelector('.last-pill').textContent = `Последно: ${formatDate(dish.lastCookedAt)}`;
      fragment.querySelector('.cook-button').addEventListener('click', async () => {
        await cookDish(dish.id);
      });
      dishesContainer.appendChild(fragment);
    });
}

async function loadData() {
  if (state.demoMode) {
    const result = localBuildApiResponse(getDemoDishes());
    renderSuggestions(result.suggestions);
    renderDishes(result.dishes);
    return;
  }

  try {
    const data = await requestJson('/api/dishes');
    renderSuggestions(data.suggestions);
    renderDishes(data.dishes);
  } catch (error) {
    if (error.status === 401) {
      await resetSession('Сесията ви изтече. Моля, влезте отново с Google.', 'error');
      return;
    }

    throw error;
  }
}

async function handleGoogleCredentialResponse(response) {
  try {
    const session = await requestJson('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential: response.credential })
    });
    state.googleClientId = session.googleClientId || state.googleClientId;
    state.user = session.user;
    state.demoMode = false;
    demoBannerElement.hidden = true;
    renderAuthState();
    setAppVisibility(true);

    const demoDishes = getDemoDishes();
    if (demoDishes.length > 0) {
      const data = await requestJson('/api/dishes/merge', {
        method: 'POST',
        body: JSON.stringify({ dishes: demoDishes })
      });
      clearDemoData();
      renderSuggestions(data.suggestions);
      renderDishes(data.dishes);
      setMessage(`${demoDishes.length} демо рецепт(и) бяха успешно обединени.`, 'success');
    } else {
      await loadData();
      setMessage('');
    }
  } catch (error) {
    setAuthMessage(error.message, 'error');
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  setMessage('');

  const payload = {
    name: nameInput.value,
    notes: notesInput.value
  };

  if (state.demoMode) {
    const name = payload.name.trim();
    if (!name) return;
    const dishes = getDemoDishes();
    if (dishes.some(d => d.name.toLowerCase() === name.toLowerCase())) {
      setMessage('Рецептата вече съществува', 'error');
      return;
    }
    dishes.push({
      id: crypto.randomUUID(),
      name,
      notes: payload.notes.trim(),
      cookCount: 0,
      cookHistory: [],
      lastCookedAt: null
    });
    saveDemoDishes(dishes);
    form.reset();
    const result = localBuildApiResponse(dishes);
    renderSuggestions(result.suggestions);
    renderDishes(result.dishes);
    setMessage('Рецептата е добавена.', 'success');
    nameInput.focus();
    return;
  }

  try {
    const data = await requestJson('/api/dishes', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    form.reset();
    renderSuggestions(data.suggestions);
    renderDishes(data.dishes);
    setMessage('Рецептата е добавена.', 'success');
    nameInput.focus();
  } catch (error) {
    if (error.status === 401) {
      await resetSession('Сесията ви изтече. Моля, влезте отново с Google.', 'error');
      return;
    }

    setMessage(error.message, 'error');
  }
});

refreshButton.addEventListener('click', async () => {
  try {
    await loadData();
    setMessage('Данните са обновени.', 'success');
  } catch (error) {
    if (error.status === 401) {
      await resetSession('Сесията ви изтече. Моля, влезте отново с Google.', 'error');
      return;
    }

    setMessage(error.message, 'error');
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    await requestJson('/api/auth/logout', { method: 'POST' });
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
    await resetSession('Успешно излязохте.', 'success');
  } catch (error) {
    setAuthMessage(error.message, 'error');
  }
});

async function initializeApp() {
  try {
    const session = await requestJson('/api/session');
    state.googleClientId = session.googleClientId || '';
    state.user = session.user;
    renderAuthState();

    if (state.user) {
      setAppVisibility(true);
      await loadData();
      return;
    }

    // Restore demo mode automatically if there are saved demo dishes
    if (getDemoDishes().length > 0) {
      state.demoMode = true;
      demoBannerElement.hidden = false;
      setAppVisibility(true);
      await loadData();
      return;
    }

    setAppVisibility(false);
  } catch (error) {
    setAppVisibility(false);
    clearDishUi();
    setAuthMessage(error.message, 'error');
  }
}

tryDemoButton.addEventListener('click', async () => {
  state.demoMode = true;
  demoBannerElement.hidden = false;
  setAppVisibility(true);
  await loadData();
});

exitDemoButton.addEventListener('click', () => {
  clearDemoData();
  state.demoMode = false;
  demoBannerElement.hidden = true;
  setAppVisibility(false);
  clearDishUi();
});

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/service-worker.js');
    } catch {
      // Service worker registration is optional; app should keep working without it.
    }
  });
}

initializeApp();
bindViewportListener();
registerServiceWorker();
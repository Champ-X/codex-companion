const elements = {
  app: document.querySelector('#app'),
  pet: document.querySelector('#pet'),
  idleMeter: document.querySelector('#idle-meter'),
  idleFiveHourValue: document.querySelector('#idle-five-hour-value'),
  tokenTotal: document.querySelector('#token-total'),
  fiveHourValue: document.querySelector('#five-hour-value'),
  weeklyValue: document.querySelector('#weekly-value'),
  fiveHourQuota: document.querySelector('#five-hour-quota'),
  weeklyQuota: document.querySelector('#weekly-quota'),
  petButton: document.querySelector('#pet-button'),
  refreshButton: document.querySelector('#refresh-button'),
};

const PETS = [
  { id: 'fox', label: '小狐' },
  { id: 'collie', label: '陨石边牧' },
  { id: 'cat', label: '大橘猫' },
];

let latestUsage = null;
let refreshDoneTimer = null;
let dragging = false;
let selectedPet = 'fox';

function safeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function formatTokens(value) {
  const number = safeNumber(value);
  const millions = number / 1_000_000;
  const maximumFractionDigits = millions >= 100 ? 0 : millions >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(millions)}M`;
}

function formatReset(epochSeconds) {
  if (!epochSeconds) return '';
  const date = new Date(epochSeconds < 1e12 ? epochSeconds * 1000 : epochSeconds);
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function renderQuota(kind, data) {
  const value = elements[`${kind}Value`];
  const item = elements[`${kind}Quota`];
  item.classList.remove('medium', 'warning', 'danger');
  if (kind === 'fiveHour') elements.idleMeter.classList.remove('medium', 'warning', 'danger');
  if (!data) {
    value.textContent = '--%';
    item.style.setProperty('--remaining', '0%');
    if (kind === 'fiveHour') {
      elements.idleMeter.style.setProperty('--remaining', '0%');
      elements.idleFiveHourValue.textContent = '--%';
    }
    return;
  }
  const remaining = Math.max(0, Math.min(100, Math.round(safeNumber(data.remainingPercent))));
  value.textContent = `${remaining}%`;
  item.style.setProperty('--remaining', `${remaining}%`);
  if (kind === 'fiveHour') {
    elements.idleMeter.style.setProperty('--remaining', `${remaining}%`);
    elements.idleFiveHourValue.textContent = `${remaining}%`;
  }
  item.classList.toggle('medium', remaining >= 40 && remaining < 60);
  item.classList.toggle('warning', remaining > 10 && remaining < 40);
  item.classList.toggle('danger', remaining <= 10);
  if (kind === 'fiveHour') {
    elements.idleMeter.classList.toggle('medium', remaining >= 40 && remaining < 60);
    elements.idleMeter.classList.toggle('warning', remaining > 10 && remaining < 40);
    elements.idleMeter.classList.toggle('danger', remaining <= 10);
  }
  item.title = data.resetsAt ? `${formatReset(data.resetsAt)} 重置` : '';
}

function applyPet(pet) {
  const selected = PETS.find(({ id }) => id === pet) || PETS[0];
  selectedPet = selected.id;
  elements.pet.classList.remove(...PETS.map(({ id }) => `pet-${id}`));
  elements.pet.classList.add(`pet-${selected.id}`);
  elements.app.classList.remove(...PETS.map(({ id }) => `theme-${id}`));
  elements.app.classList.add(`theme-${selected.id}`);
  elements.pet.setAttribute('aria-label', `Codex ${selected.label}`);
  elements.pet.title = `按住${selected.label}拖动`;
  const next = PETS[(PETS.findIndex(({ id }) => id === selected.id) + 1) % PETS.length];
  elements.petButton.title = `切换为${next.label}`;
}

function applyPetState(lowest) {
  const state = window.CodexQuotaState.classifyQuotaState(lowest);
  elements.pet.classList.remove('state-energized', 'state-focused', 'state-checking', 'state-worried', 'state-sleepy');
  elements.pet.classList.add(`state-${state}`);
  elements.pet.dataset.quotaState = state;
}

function renderUsage(usage) {
  latestUsage = usage;
  elements.app.classList.remove('loading');
  if (usage?.dataSource === 'app-server-cache' || usage?.dataSource === 'last-good') {
    elements.refreshButton.title = '实时同步暂时失败 · 保持上次可信额度';
  } else if (usage?.isLive) {
    elements.refreshButton.title = '实时数据 · 点击刷新';
  } else if (usage?.ok) {
    elements.refreshButton.title = '本地缓存 · 点击重试实时同步';
  } else {
    elements.refreshButton.title = usage?.liveError || '暂时无法读取数据';
  }

  renderQuota('fiveHour', usage?.limits?.fiveHour);
  renderQuota('weekly', usage?.limits?.weekly);
  elements.tokenTotal.textContent = formatTokens(usage?.today?.displayTokens);

  const petRemaining = window.CodexQuotaState.selectPetRemaining(usage?.limits);
  applyPetState(petRemaining);
}

async function refresh() {
  clearTimeout(refreshDoneTimer);
  elements.refreshButton.title = '正在实时同步';
  elements.refreshButton.classList.add('spinning');
  try {
    renderUsage(await window.codexPet.refreshUsage());
  } finally {
    refreshDoneTimer = setTimeout(() => elements.refreshButton.classList.remove('spinning'), 180);
  }
}

function dragPoint(event) {
  return { screenX: event.screenX, screenY: event.screenY };
}

for (const handle of document.querySelectorAll('.drag-strip, #pet')) {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dragging = true;
    handle.setPointerCapture?.(event.pointerId);
    document.body.classList.add('dragging');
    window.codexPet.beginDrag(dragPoint(event));
    event.preventDefault();
  });
}

window.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  if ((event.buttons & 1) === 0) {
    dragging = false;
    document.body.classList.remove('dragging');
    window.codexPet.endDrag();
    return;
  }
  window.codexPet.moveDrag(dragPoint(event));
});

window.addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging = false;
  document.body.classList.remove('dragging');
  window.codexPet.endDrag();
});

window.addEventListener('blur', () => {
  if (!dragging) return;
  dragging = false;
  document.body.classList.remove('dragging');
  window.codexPet.endDrag();
});

document.querySelector('#refresh-button').addEventListener('click', refresh);
document.querySelector('#hide-button').addEventListener('click', () => window.codexPet.hide());
elements.petButton.addEventListener('click', async () => {
  const index = PETS.findIndex(({ id }) => id === selectedPet);
  applyPet(await window.codexPet.setPet(PETS[(index + 1) % PETS.length].id));
});
window.codexPet.onUsage(renderUsage);
window.codexPet.onSettings((settings) => applyPet(settings.pet));
window.codexPet.getSettings().then((settings) => applyPet(settings.pet));
window.codexPet.getUsage().then(renderUsage);

const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { CodexUsageService } = require('./usage-service');
const { CodexAppServerClient } = require('./app-server-client');

const IS_MAC = process.platform === 'darwin';
const WINDOW_SIZES = {
  default: { width: 248, height: 232 },
};
const PET_TYPES = ['fox', 'collie', 'cat'];

let mainWindow = null;
let tray = null;
let refreshTimer = null;
let refreshPromise = null;
let saveTimer = null;
let isQuitting = false;
let usageSnapshot = null;
const liveClient = new CodexAppServerClient({ clientVersion: '2.1.6' });
const usageService = new CodexUsageService({ liveClient });
let dragState = null;
let restoringWindowSize = false;

const defaultSettings = {
  alwaysOnTop: true,
  launchAtLogin: false,
  windowPosition: null,
  pet: 'fox',
};

let settings = { ...defaultSettings };

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    settings = {
      ...defaultSettings,
      ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')),
    };
    if (!PET_TYPES.includes(settings.pet)) settings.pet = defaultSettings.pet;
  } catch {
    settings = { ...defaultSettings };
  }
}

function syncLaunchAtLoginSetting() {
  if (!app.isPackaged) return;
  try {
    settings.launchAtLogin = Boolean(app.getLoginItemSettings().openAtLogin);
  } catch (error) {
    console.warn('Could not read login item settings:', error.message);
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (error) {
    console.warn('Could not save Codex Companion settings:', error.message);
  }
}

function scheduleSettingsSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 300);
}

function isPositionVisible(position, size) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX = position.x < workArea.x + workArea.width && position.x + size.width > workArea.x;
    const overlapY = position.y < workArea.y + workArea.height && position.y + size.height > workArea.y;
    return overlapX && overlapY;
  });
}

function initialWindowBounds() {
  const size = WINDOW_SIZES.default;
  if (isPositionVisible(settings.windowPosition, size)) {
    return { ...size, ...settings.windowPosition };
  }

  const { workArea } = screen.getPrimaryDisplay();
  return {
    ...size,
    x: workArea.x + workArea.width - size.width - 24,
    y: workArea.y + workArea.height - size.height - 24,
  };
}

function createWindow() {
  const fixedSize = WINDOW_SIZES.default;
  mainWindow = new BrowserWindow({
    ...initialWindowBounds(),
    minWidth: fixedSize.width,
    maxWidth: fixedSize.width,
    minHeight: fixedSize.height,
    maxHeight: fixedSize.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: settings.alwaysOnTop,
    show: false,
    hasShadow: false,
    title: 'Codex Companion',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  if (IS_MAC) {
    mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  }
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.on('will-resize', (event) => event.preventDefault());
  mainWindow.on('resize', () => {
    if (!mainWindow || restoringWindowSize) return;
    const [width, height] = mainWindow.getSize();
    if (width === fixedSize.width && height === fixedSize.height) return;
    restoringWindowSize = true;
    mainWindow.setSize(fixedSize.width, fixedSize.height, false);
    restoringWindowSize = false;
  });

  mainWindow.on('move', () => {
    if (!mainWindow) return;
    const [x, y] = mainWindow.getPosition();
    settings.windowPosition = { x, y };
    scheduleSettingsSave();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function trayIcon() {
  if (IS_MAC) {
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'tray', 'trayTemplate.png')
      : path.join(__dirname, '..', 'assets', 'trayTemplate.png');
    const template = nativeImage.createFromPath(iconPath);
    if (!template.isEmpty()) {
      template.setTemplateImage(true);
      return template;
    }
    console.warn(`Could not load the macOS tray icon from ${iconPath}`);
    return nativeImage.createEmpty();
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7758e8"/><stop offset="1" stop-color="#ff9f66"/></linearGradient></defs>
      <path fill="url(#g)" d="M7 11 9 4l6 4h2l6-4 2 7a11 11 0 1 1-18 0Z"/>
      <circle cx="12" cy="16" r="1.5" fill="white"/><circle cx="20" cy="16" r="1.5" fill="white"/>
      <path d="m14 21 2 1 2-1" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  );
  if (icon.isEmpty()) return nativeImage.createFromPath(process.execPath);
  return icon;
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: mainWindow?.isVisible() ? '隐藏 Codex Companion' : '显示 Codex Companion',
        click: () => toggleWindow(),
      },
      { label: '立即刷新', click: () => refreshUsage(true) },
      { type: 'separator' },
      {
        label: '保持置顶',
        type: 'checkbox',
        checked: settings.alwaysOnTop,
        click: (item) => updateAlwaysOnTop(item.checked),
      },
      {
        label: '开机启动',
        type: 'checkbox',
        checked: settings.launchAtLogin,
        click: (item) => updateLaunchAtLogin(item.checked),
      },
      {
        label: '宠物形象',
        submenu: [
          { label: '小狐', type: 'radio', checked: settings.pet === 'fox', click: () => updatePet('fox') },
          { label: '陨石边牧', type: 'radio', checked: settings.pet === 'collie', click: () => updatePet('collie') },
          { label: '大橘猫', type: 'radio', checked: settings.pet === 'cat', click: () => updatePet('cat') },
        ],
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray() {
  const icon = trayIcon();
  tray = new Tray(
    icon,
    IS_MAC ? '3d3e0a88-6848-4b9b-ae22-811c9547a9f9' : undefined,
  );
  if (IS_MAC && icon.isEmpty()) tray.setTitle('CC');
  tray.setToolTip('Codex Companion · 用量悬浮助手');
  if (!IS_MAC) tray.on('click', () => toggleWindow());
  rebuildTrayMenu();
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
    refreshUsage();
  }
  rebuildTrayMenu();
}

async function refreshUsage(force = false) {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      usageSnapshot = await usageService.getUsage({ force });
    } catch (error) {
      usageSnapshot = usageSnapshot?.limits
        ? {
            ...usageSnapshot,
            isLive: false,
            isStaleRate: true,
            dataSource: 'last-good',
            liveError: error.message,
            updatedAt: new Date().toISOString(),
          }
        : {
            ok: false,
            updatedAt: new Date().toISOString(),
            source: usageService.codexDir,
            today: {
              totalTokens: 0,
              displayTokens: 0,
              source: 'unavailable',
              processedTokens: 0,
              effectiveTokens: 0,
              inputTokens: 0,
              uncachedInputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              reasoningOutputTokens: 0,
            },
            limits: null,
            message: `读取失败：${error.message}`,
          };
    }
    mainWindow?.webContents.send('usage:update', usageSnapshot);
    return usageSnapshot;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

function updateAlwaysOnTop(enabled) {
  settings.alwaysOnTop = Boolean(enabled);
  mainWindow?.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  scheduleSettingsSave();
  rebuildTrayMenu();
  mainWindow?.webContents.send('settings:update', settings);
  return settings.alwaysOnTop;
}

function updateLaunchAtLogin(enabled) {
  settings.launchAtLogin = Boolean(enabled);
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
  }
  scheduleSettingsSave();
  rebuildTrayMenu();
  mainWindow?.webContents.send('settings:update', settings);
  return settings.launchAtLogin;
}

function updatePet(pet) {
  if (!PET_TYPES.includes(pet)) return settings.pet;
  settings.pet = pet;
  scheduleSettingsSave();
  rebuildTrayMenu();
  mainWindow?.webContents.send('settings:update', settings);
  return settings.pet;
}

function registerIpc() {
  ipcMain.handle('usage:get', () => usageSnapshot || refreshUsage());
  ipcMain.handle('usage:refresh', () => refreshUsage(true));
  ipcMain.handle('settings:get', () => ({ ...settings, dataPath: usageService.codexDir }));
  ipcMain.handle('settings:always-on-top', (_event, value) => updateAlwaysOnTop(value));
  ipcMain.handle('settings:launch-at-login', (_event, value) => updateLaunchAtLogin(value));
  ipcMain.handle('settings:pet', (_event, value) => updatePet(value));
  ipcMain.on('window:hide', () => {
    mainWindow?.hide();
    rebuildTrayMenu();
  });
  ipcMain.on('window:drag-start', (event, point) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    if (!Number.isFinite(point?.screenX) || !Number.isFinite(point?.screenY)) return;
    const [windowX, windowY] = mainWindow.getPosition();
    const { width, height } = WINDOW_SIZES.default;
    mainWindow.setBounds({ x: windowX, y: windowY, width, height }, false);
    dragState = {
      pointerX: point.screenX,
      pointerY: point.screenY,
      windowX,
      windowY,
    };
  });
  ipcMain.on('window:drag-move', (event, point) => {
    if (!mainWindow || !dragState || event.sender !== mainWindow.webContents) return;
    if (!Number.isFinite(point?.screenX) || !Number.isFinite(point?.screenY)) return;
    const { width, height } = WINDOW_SIZES.default;
    mainWindow.setBounds({
      x: Math.round(dragState.windowX + point.screenX - dragState.pointerX),
      y: Math.round(dragState.windowY + point.screenY - dragState.pointerY),
      width,
      height,
    }, false);
  });
  ipcMain.on('window:drag-end', (event) => {
    if (mainWindow && event.sender === mainWindow.webContents) dragState = null;
  });
  ipcMain.on('window:quit', () => {
    isQuitting = true;
    app.quit();
  });
  ipcMain.handle('folder:open-codex', () => shell.openPath(usageService.codexDir));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
    rebuildTrayMenu();
    refreshUsage();
  });

  app.whenReady().then(async () => {
    if (IS_MAC) app.setActivationPolicy('accessory');
    loadSettings();
    syncLaunchAtLoginSetting();
    registerIpc();
    createWindow();
    createTray();
    await refreshUsage();
    refreshTimer = setInterval(() => refreshUsage(), 30_000);
  });
}

app.on('activate', () => {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
    mainWindow.focus();
    rebuildTrayMenu();
    refreshUsage();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  clearInterval(refreshTimer);
  clearTimeout(saveTimer);
  liveClient.stop();
  saveSettings();
});

app.on('window-all-closed', () => {
  // Keep the tray process alive on desktop platforms.
});

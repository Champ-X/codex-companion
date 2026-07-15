const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const appIconSourcePath = path.join(projectRoot, 'assets', 'icon.svg');
const appIconOutputPath = path.join(projectRoot, 'assets', 'icon.png');
const trayIconSourcePath = path.join(projectRoot, 'assets', 'trayTemplate.svg');
const trayIconOutputPath = path.join(projectRoot, 'assets', 'trayTemplate.png');
const trayIcon2xOutputPath = path.join(projectRoot, 'assets', 'trayTemplate@2x.png');

async function renderSvg(renderer, sourcePath, size) {
  const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/width="[^"]+"/, `width="${size}"`)
    .replace(/height="[^"]+"/, `height="${size}"`);
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;
  renderer.setContentSize(size, size, false);
  await renderer.loadURL(dataUrl);
  const rendered = await renderer.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  if (rendered.isEmpty()) throw new Error(`Could not render ${sourcePath}`);

  const renderedSize = rendered.getSize();
  return renderedSize.width === size && renderedSize.height === size
    ? rendered
    : rendered.resize({ width: size, height: size, quality: 'best' });
}

function writeIcon(outputPath, icon, expectedSize) {
  const { width, height } = icon.getSize();
  if (width !== expectedSize || height !== expectedSize) {
    throw new Error(`Expected a ${expectedSize}x${expectedSize} icon, received ${width}x${height}`);
  }

  fs.writeFileSync(outputPath, icon.toPNG());
  console.log(`Generated ${outputPath} (${width}x${height})`);
}

async function generateIcons() {
  const rendererOptions = {
    width: 1024,
    height: 1024,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: true,
    },
  };
  const appIconRenderer = new BrowserWindow(rendererOptions);
  const trayIconRenderer = new BrowserWindow(rendererOptions);

  try {
    const [appIcon, traySource] = await Promise.all([
      renderSvg(appIconRenderer, appIconSourcePath, 1024),
      renderSvg(trayIconRenderer, trayIconSourcePath, 1024),
    ]);
    writeIcon(appIconOutputPath, appIcon, 1024);

    const trayIcon = traySource.resize({ width: 16, height: 16, quality: 'best' });
    const trayIcon2x = traySource.resize({ width: 32, height: 32, quality: 'best' });

    writeIcon(trayIconOutputPath, trayIcon, 16);
    writeIcon(trayIcon2xOutputPath, trayIcon2x, 32);
  } finally {
    appIconRenderer.destroy();
    trayIconRenderer.destroy();
  }
}

app.whenReady()
  .then(generateIcons)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error.message);
    app.exit(1);
  });

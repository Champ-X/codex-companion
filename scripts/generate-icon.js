const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'assets', 'icon.svg');
const outputPath = path.join(projectRoot, 'assets', 'icon.png');

async function generateIcon() {
  const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/width="512"/, 'width="1024"')
    .replace(/height="512"/, 'height="1024"');
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;
  const renderer = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: true,
    },
  });

  await renderer.loadURL(dataUrl);
  const rendered = await renderer.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  renderer.destroy();
  if (rendered.isEmpty()) throw new Error(`Could not render ${sourcePath}`);

  const renderedSize = rendered.getSize();
  const icon = renderedSize.width === 1024 && renderedSize.height === 1024
    ? rendered
    : rendered.resize({ width: 1024, height: 1024, quality: 'best' });

  const { width, height } = icon.getSize();
  if (width !== 1024 || height !== 1024) {
    throw new Error(`Expected a 1024x1024 icon, received ${width}x${height}`);
  }

  fs.writeFileSync(outputPath, icon.toPNG());
  console.log(`Generated ${outputPath} (${width}x${height})`);
}

app.whenReady()
  .then(generateIcon)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error.message);
    app.exit(1);
  });

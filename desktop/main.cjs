const { app, BrowserWindow, dialog, session } = require("electron");
const fileSystem = require("node:fs/promises");
const path = require("node:path");
const { createReleaseProfileRoot, prepareReleaseProfile, PROFILE_SCHEMA } = require("./profile.cjs");

const version = app.getVersion();
const smokeOutput = process.env.COSMIC_CATCHERS_SMOKE_OUTPUT || "";
const profileRoot = process.env.COSMIC_CATCHERS_USER_DATA || createReleaseProfileRoot({
  appData: app.getPath("appData"),
  version
});
const partition = `persist:cosmic-catchers-${version}-${PROFILE_SCHEMA}`.replace(/[^a-z0-9-]/gi, "-");

app.setPath("userData", profileRoot);

function productionFile() {
  return path.join(__dirname, "..", "dist", "## JOGUE AQUI.html");
}

function createWindow(activeSession) {
  const window = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: "#160a2b",
    height: 900,
    minHeight: 650,
    minWidth: 900,
    show: !smokeOutput,
    title: "Cosmic Catchers",
    width: 1440,
    webPreferences: {
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      partition,
      sandbox: true,
      session: activeSession
    }
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  return window;
}

async function writeSmokeResult(window) {
  const snapshot = await window.webContents.executeJavaScript(`(() => ({
    best: document.getElementById("best")?.textContent || "",
    ready: !document.getElementById("ready-screen")?.classList.contains("hidden"),
    score: document.getElementById("score")?.textContent || "",
    storage: Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]))
  }))()`);
  await fileSystem.mkdir(path.dirname(smokeOutput), { recursive: true });
  await fileSystem.writeFile(smokeOutput, JSON.stringify(snapshot), "utf8");
  app.quit();
}

async function launch() {
  const activeSession = session.fromPartition(partition);
  await prepareReleaseProfile({ storageSession: activeSession, profileRoot, version });
  const window = createWindow(activeSession);
  await window.loadFile(productionFile());
  if (smokeOutput) await writeSmokeResult(window);
}

function reportFatal(error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  if (smokeOutput) {
    fileSystem.mkdir(path.dirname(smokeOutput), { recursive: true })
      .then(() => fileSystem.writeFile(smokeOutput, JSON.stringify({ error: message }), "utf8"))
      .finally(() => app.exit(1));
    return;
  }
  dialog.showErrorBox("Cosmic Catchers could not start", message);
  app.exit(1);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(launch).catch(reportFatal);
  app.on("window-all-closed", () => app.quit());
}

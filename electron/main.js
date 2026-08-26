const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { startMeetingDetection } = require('./meetingDetector');

let mainWindow;
let isRecording = false;
let stopMeetingDetection = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: "Meeting Translator"
  });

  mainWindow.loadURL('http://localhost:3000');
  
  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // IPC Handlers
  ipcMain.handle('backend:get', () => {
    return { ready: true, port: 3000 };
  });

  ipcMain.handle('file:save', async (event, defaultName, content) => {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [{ name: 'Text Files', extensions: ['txt'] }]
    });
    if (filePath) {
      fs.writeFileSync(filePath, content, 'utf-8');
      return filePath;
    }
    return null;
  });

  ipcMain.handle('settings:get', () => {
    try {
      const data = fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      return {};
    }
  });

  ipcMain.handle('settings:set', (event, settings) => {
    try {
      fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(settings), 'utf-8');
      return settings;
    } catch (e) {
      return settings;
    }
  });

  ipcMain.handle('open:external', (event, url) => {
    shell.openExternal(url);
  });

  ipcMain.on('recording:state', (event, value) => {
    isRecording = !!value;
  });

  // Start the Express backend directly in the main process
  process.env.PORT = '3000';
  process.env.NODE_ENV = 'production';

  let serverReady;
  try {
    serverReady = require(path.join(__dirname, '../dist/server.cjs'));
  } catch (err) {
    dialog.showErrorBox('Failed to load backend module', String((err && err.stack) || err));
    app.quit();
    return;
  }

  Promise.resolve(serverReady)
    .then(() => {
      createWindow();
      app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });

      stopMeetingDetection = startMeetingDetection(
        (meetings) => {
          if (mainWindow) mainWindow.webContents.send('meeting-detected', { meetings });
        },
        () => isRecording,
        () => {
          if (mainWindow) {
            mainWindow.webContents.send(
              'meeting-detection-permission-needed',
              'Meeting detection needs permission to see other apps’ windows. Open System Settings → Privacy & Security → Automation (and Accessibility) and allow Meeting Translator to control System Events.'
            );
          }
        }
      );
    })
    .catch((err) => {
      dialog.showErrorBox('Backend failed to start', String((err && err.stack) || err));
      app.quit();
    });
});

app.on('will-quit', () => {
  if (stopMeetingDetection) stopMeetingDetection();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});


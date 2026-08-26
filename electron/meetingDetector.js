const { execFile } = require('child_process');

const POLL_INTERVAL_MS = 5000;
const SHELL_TIMEOUT_MS = 4000;

const APPS = [
  {
    id: 'zoom',
    label: 'Zoom',
    processMatch: /zoom\.us|^zoom$/i,
    isInCall(title) {
      const t = (title || '').trim();
      if (!t) return false;
      const idle = ['zoom workplace', 'zoom cloud meetings', 'zoom'];
      return !idle.includes(t.toLowerCase());
    }
  },
  {
    id: 'teams',
    label: 'Microsoft Teams',
    processMatch: /microsoft\s*teams|msteams|ms-teams|^teams$/i,
    isInCall(title) {
      const t = (title || '').trim();
      if (!t) return false;
      if (/meeting/i.test(t)) return true;
      if (/\|\s*microsoft teams/i.test(t)) {
        return !/^(chat|activity|calendar|teams|apps|files)\s*\|/i.test(t);
      }
      return false;
    }
  },
  {
    id: 'meet',
    label: 'Google Meet',
    processMatch: /chrome|edge|msedge|brave/i,
    isInCall(title) {
      const t = (title || '').trim();
      if (!t) return false;
      return /meet\s*-\s*\S/i.test(t) || /google meet/i.test(t);
    }
  }
];

function runMac() {
  const script = `
tell application "System Events"
  set out to ""
  repeat with proc in (every process whose visible is true)
    try
      set procName to name of proc
      set winNames to name of every window of proc
      repeat with w in winNames
        set out to out & procName & tab & w & linefeed
      end repeat
    end try
  end repeat
  return out
end tell`;
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: SHELL_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err || !stdout) {
        const combined = `${(err && err.message) || ''} ${stderr || ''}`;
        const permissionDenied = /-1743|-609|not authorized|not allowed to send apple events/i.test(combined);
        return resolve({ windows: [], permissionDenied });
      }
      const rows = stdout
        .split('\n')
        .map((line) => line.split('\t'))
        .filter((parts) => parts.length >= 2)
        .map(([processName, title]) => ({ processName, title }));
      resolve({ windows: rows, permissionDenied: false });
    });
  });
}

function runWindows() {
  const script =
    'Get-Process | Where-Object { $_.MainWindowTitle } | ' +
    'Select-Object -Property ProcessName,MainWindowTitle | ConvertTo-Json -Compress';
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: SHELL_TIMEOUT_MS },
      (err, stdout) => {
        if (err || !stdout) return resolve({ windows: [], permissionDenied: false });
        try {
          const parsed = JSON.parse(stdout);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          resolve({
            windows: list.map((p) => ({ processName: p.ProcessName || '', title: p.MainWindowTitle || '' })),
            permissionDenied: false
          });
        } catch {
          resolve({ windows: [], permissionDenied: false });
        }
      }
    );
  });
}

async function listWindows() {
  if (process.platform === 'darwin') return runMac();
  if (process.platform === 'win32') return runWindows();
  return { windows: [], permissionDenied: false };
}

async function checkForMeetings() {
  const { windows, permissionDenied } = await listWindows();
  const matches = [];
  for (const win of windows) {
    for (const appDef of APPS) {
      if (appDef.processMatch.test(win.processName) && appDef.isInCall(win.title)) {
        matches.push({ app: appDef.label, title: win.title.trim() });
      }
    }
  }
  return { matches, permissionDenied };
}

function startMeetingDetection(onDetected, isSuppressed, onPermissionIssue) {
  const notified = new Set();
  let permissionIssueReported = false;
  let timer = null;

  const key = (m) => `${m.app}::${m.title}`;

  const poll = async () => {
    try {
      if (isSuppressed()) return;
      const { matches, permissionDenied } = await checkForMeetings();

      if (permissionDenied) {
        if (!permissionIssueReported) {
          permissionIssueReported = true;
          if (onPermissionIssue) onPermissionIssue();
        }
        return;
      }

      const currentKeys = new Set(matches.map(key));
      for (const k of Array.from(notified)) {
        if (!currentKeys.has(k)) notified.delete(k);
      }

      const fresh = matches.filter((m) => !notified.has(key(m)));
      if (fresh.length > 0) {
        fresh.forEach((m) => notified.add(key(m)));
        onDetected(fresh);
      }
    } catch {
      /* detection is best-effort; ignore transient failures */
    }
  };

  timer = setInterval(poll, POLL_INTERVAL_MS);
  return () => clearInterval(timer);
}

module.exports = { startMeetingDetection, checkForMeetings };

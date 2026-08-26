const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getBackend: () => ipcRenderer.invoke('backend:get'),
  saveTxt: (defaultName, content) => ipcRenderer.invoke('file:save', defaultName, content),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  setRecordingState: (isRecording) => ipcRenderer.send('recording:state', isRecording),
  onMeetingDetected: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('meeting-detected', handler);
    return () => ipcRenderer.removeListener('meeting-detected', handler);
  },
  onMeetingDetectionPermissionNeeded: (callback) => {
    const handler = (event, message) => callback(message);
    ipcRenderer.on('meeting-detection-permission-needed', handler);
    return () => ipcRenderer.removeListener('meeting-detection-permission-needed', handler);
  }
});

import { contextBridge, ipcRenderer } from 'electron';

type EmergencyAction = 'complete' | 'snooze' | 'skip';

// This bridge intentionally exposes one send-only capability. The main process
// binds the action to the exact emergency WebContents and active reminder, so a
// data: page can neither invoke the regular renderer API nor choose an id.
contextBridge.exposeInMainWorld('eyeProtectEmergency', {
  action: (action: EmergencyAction): void => {
    ipcRenderer.send('emergency-reminder:action', action);
  }
});

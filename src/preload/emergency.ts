import { contextBridge, ipcRenderer } from 'electron';

type EmergencyAction = 'start' | 'complete' | 'snooze' | 'skip';

// This bridge intentionally exposes one send-only capability. The main process
// binds the action to the exact emergency WebContents and active reminder, so a
// data: page can neither invoke the regular renderer API nor choose an id.
contextBridge.exposeInMainWorld('eyeProtectEmergency', {
  onState: (callback: (state: { started: boolean; unlockAt: number }) => void): void => {
    ipcRenderer.on('emergency-reminder:state', (_event, state) => callback(state));
  },
  action: (action: EmergencyAction): void => {
    ipcRenderer.send('emergency-reminder:action', action);
  }
});

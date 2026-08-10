// Minimal Electron surface stub so the ReminderSurfaceManager can be unit
// tested under plain Node (tsx --test cannot resolve the real 'electron' module).
// Only the touches used by reminderSurface.ts are implemented; behaviour is
// configurable per test via the exported mutable flags.
import { EventEmitter } from 'node:events';

let nextWebContentsId = 1;

export class BrowserWindow {
  static _instances = [];

  constructor(_options = {}) {
    this.id = nextWebContentsId++;
    this.webContents = new EventEmitter();
    this.webContents.id = this.id;
    this.webContents.isCrashed = () => false;
    this.webContents.send = () => {};
    this.webContents.invalidate = () => {};
    this._destroyed = false;
    this._visible = false;
    this._alwaysOnTopLevel = null;
    BrowserWindow._instances.push(this);
  }

  setAlwaysOnTop(level) {
    this._alwaysOnTopLevel = level;
    return this;
  }

  on() {
    return this;
  }

  once() {
    return this;
  }

  removeListener() {
    return this;
  }

  isDestroyed() {
    return this._destroyed;
  }

  isVisible() {
    return this._visible;
  }

  show() {
    this._visible = true;
    return this;
  }

  showInactive() {
    this._visible = true;
    return this;
  }

  hide() {
    this._visible = false;
    return this;
  }

  flashFrame() {
    return this;
  }

  destroy() {
    this._destroyed = true;
    this._visible = false;
    return this;
  }

  getBounds() {
    return { x: 0, y: 0, width: 160, height: 160 };
  }

  setBounds() {
    return this;
  }

  loadURL() {
    return Promise.resolve();
  }

  loadFile() {
    return Promise.resolve();
  }

  focus() {
    return this;
  }

  close() {
    this._destroyed = true;
    return this;
  }

  setSkipTaskbar() {
    return this;
  }

  setIgnoreMouseEvents() {
    return this;
  }
}

export class Notification extends EventEmitter {
  static _supported = true;
  static _instances = [];

  constructor(options = {}) {
    super();
    this.options = options;
    Notification._instances.push(this);
  }

  show() {
    return this;
  }

  static isSupported() {
    return Notification._supported;
  }
}

export const app = {
  _isReady: true,
  isReady() {
    return app._isReady;
  }
};

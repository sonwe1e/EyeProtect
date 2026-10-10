import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import type { Settings } from '../shared/types';
import type { ReminderGateDecision } from './reminders';

export interface ContextSample {
  foregroundApp: string | null;
  fullscreen: boolean;
  microphone: boolean;
  camera: boolean;
  /** Aggregate key-down transitions; key identities and text never leave the helper. */
  keyCount: number;
  keyIdleMs: number;
}

const MEETING_APPS = new Set(['zoom', 'teams', 'ms-teams', 'wemeetapp', 'voovmeeting', 'tencentmeeting', 'webex', 'webexhost', 'ciscowebexstart']);
const SAMPLE_MAX_AGE_MS = 5_000;
const INPUT_PAUSE_MS = 3_000;

export const contextDecision = (
  settings: Settings,
  sample: ContextSample | null,
  typing: boolean,
  now: number
): ReminderGateDecision => {
  const date = new Date(now);
  const minute = date.getHours() * 60 + date.getMinutes();
  const start = settings.quietHoursStartMinutes;
  const end = settings.quietHoursEndMinutes;
  const inQuietHours = start === end || (start < end ? minute >= start && minute < end : minute >= start || minute < end);
  const defer = (reason: string, seconds: number): ReminderGateDecision => ({
    action: 'defer', reason, deferSeconds: seconds, waitForContext: true,
    foregroundApp: sample?.foregroundApp ?? null
  });
  if (settings.quietHoursEnabled && inQuietHours) return defer('当前处于定时免打扰时段', 30);
  if (!sample) return { action: 'show' };
  if (settings.fullscreenDndEnabled && sample.fullscreen) return defer('全屏应用使用中，退出全屏后再提醒', 10);
  if (!settings.foregroundDetectionEnabled) return { action: 'show' };
  if (sample.camera || sample.microphone) return defer('摄像头或麦克风使用中，结束后再提醒', 10);
  const foreground = sample.foregroundApp?.replace(/\.exe$/i, '').toLowerCase() ?? '';
  if (MEETING_APPS.has(foreground) || settings.quietAppWhitelist.includes(foreground)) {
    return defer('会议或免打扰应用在前台，切换后再提醒', 10);
  }
  if (typing && sample.keyIdleMs < INPUT_PAUSE_MS) return defer('正在连续输入，停顿片刻后再提醒', 2);
  return { action: 'show' };
};

// Windows has no Electron API for these signals. One hidden helper samples
// key-down state at 40ms, emits counts once per second, and reads window/device
// state every two seconds. No hooks, typed text, window titles or recording.
// ConsentStore is a best-effort Windows signal, not a supported device API;
// unavailable keys return false and the scheduler keeps its usual behavior.
export const WINDOWS_CONTEXT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32;
public static class EyeProtectContext {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L,T,R,B; }
  [StructLayout(LayoutKind.Sequential)] public struct Monitor { public int Size; public Rect Bounds,Work; public uint Flags; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr h, ref Monitor info);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("kernel32.dll")] static extern ulong GetTickCount64();
  static bool[] down = new bool[256];
  public static int Keys() {
    int count=0;
    for(int key=8; key<255; key++) {
      bool pressed=GetAsyncKeyState(key)<0;
      // Exclude modifiers, function keys and navigation: text keys only.
      bool text=key==8 || key==13 || key==32 || (key>=48 && key<=90) || (key>=96 && key<=111) || (key>=186 && key<=226);
      if(text && pressed && !down[key]) count++;
      down[key]=pressed;
    }
    return count;
  }
  public static string Foreground(out bool full) {
    full=false;
    IntPtr h=GetForegroundWindow(); uint id;
    GetWindowThreadProcessId(h,out id);
    string name="";
    try { using(var p=Process.GetProcessById((int)id)) name=p.ProcessName.ToLowerInvariant(); } catch {}
    Rect r; var m=new Monitor(); m.Size=Marshal.SizeOf(m);
    if(name!="explorer" && name!="shellexperiencehost" && GetWindowRect(h,out r) && GetMonitorInfo(MonitorFromWindow(h,2),ref m)) {
      full=r.L<=m.Bounds.L && r.T<=m.Bounds.T && r.R>=m.Bounds.R && r.B>=m.Bounds.B;
    }
    return name;
  }
  static bool LiveUse(RegistryKey key, int depth) {
    if(key==null) return false;
    object start=key.GetValue("LastUsedTimeStart"), stop=key.GetValue("LastUsedTimeStop");
    if(start is long && (long)start>0 && stop is long && (long)stop==0) {
      // Ignore stale entries from an earlier boot and exited desktop apps.
      long boot=DateTime.UtcNow.AddMilliseconds(-(double)GetTickCount64()).ToFileTimeUtc();
      if((long)start>=boot) {
        string name=key.Name;
        if(name.IndexOf("NonPackaged",StringComparison.OrdinalIgnoreCase)<0) return true;
        string exe=name.Substring(name.LastIndexOf('#')+1);
        if(exe.EndsWith(".exe",StringComparison.OrdinalIgnoreCase)) {
          var processes=Process.GetProcessesByName(exe.Substring(0,exe.Length-4));
          bool running=processes.Length>0;
          foreach(var p in processes) p.Dispose();
          if(running) return true;
        }
      }
    }
    if(depth>0) foreach(string name in key.GetSubKeyNames()) {
      using(var child=key.OpenSubKey(name)) if(LiveUse(child,depth-1)) return true;
    }
    return false;
  }
  public static bool Device(string kind) {
    try { using(var key=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\"+kind)) return LiveUse(key,2); } catch { return false; }
  }
}
'@ | Out-Null
$count=0; $lastKey=[DateTime]::UtcNow; $lastReport=[DateTime]::UtcNow; $lastScene=[DateTime]::MinValue
$app=''; $full=$false; $mic=$false; $cam=$false
while ($true) {
  $keys=0
  if ($readSmart) { $keys=[EyeProtectContext]::Keys() }
  $count+=$keys
  $now=[DateTime]::UtcNow
  if ($keys -gt 0) { $lastKey=$now }
  if (($now-$lastScene).TotalSeconds -ge 2) {
    $app=[EyeProtectContext]::Foreground([ref]$full)
    if ($readSmart) { $mic=[EyeProtectContext]::Device('microphone'); $cam=[EyeProtectContext]::Device('webcam') }
    $lastScene=$now
  }
  if (($now-$lastReport).TotalSeconds -ge 1) {
    @{foregroundApp=$app; fullscreen=$full; microphone=$mic; camera=$cam; keyCount=$count; keyIdleMs=[int]($now-$lastKey).TotalMilliseconds} | ConvertTo-Json -Compress
    $count=0; $lastReport=$now
  }
  Start-Sleep -Milliseconds 40
}
`;

export class ReminderContextMonitor {
  private child: ChildProcessWithoutNullStreams | null = null;
  private sample: ContextSample | null = null;
  private sampledAt = 0;
  private counts: Array<{ at: number; count: number }> = [];
  private enabled = false;
  private smartEnabled = false;
  private retryAfter = 0;

  constructor(private readonly onError: (message: string) => void) {}

  configure(settings: Settings): void {
    if (this.smartEnabled !== settings.foregroundDetectionEnabled) this.stop();
    this.smartEnabled = settings.foregroundDetectionEnabled;
    this.enabled = process.platform === 'win32' && process.env.EYEPROTECT_SMOKE !== '1' &&
      (settings.foregroundDetectionEnabled || settings.fullscreenDndEnabled);
    if (this.enabled) this.start();
    else this.stop();
  }

  decision(settings: Settings, now = Date.now()): ReminderGateDecision {
    if (this.enabled) this.start();
    const sample = now - this.sampledAt <= SAMPLE_MAX_AGE_MS ? this.sample : null;
    const typing = this.counts.filter((entry) => now - entry.at <= 5_000).reduce((sum, entry) => sum + entry.count, 0) >= 6;
    return contextDecision(settings, sample, typing, now);
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    child?.kill();
    this.sample = null;
    this.counts = [];
  }

  private start(): void {
    if (this.child || Date.now() < this.retryAfter) return;
    const child = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`$readSmart = $${this.smartEnabled ? 'true' : 'false'}\n${WINDOWS_CONTEXT_SCRIPT}`, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: 'pipe' });
    this.child = child;
    let buffer = '';
    let errors = '';
    child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-2_000); });
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      if (buffer.length > 4_096) buffer = '';
      for (const line of lines) {
        try {
          const value = JSON.parse(line) as ContextSample;
          if (typeof value.fullscreen !== 'boolean' || typeof value.microphone !== 'boolean' || typeof value.camera !== 'boolean' || !Number.isFinite(value.keyCount) || !Number.isFinite(value.keyIdleMs)) continue;
          const now = Date.now();
          this.sample = { ...value, foregroundApp: typeof value.foregroundApp === 'string' ? value.foregroundApp.slice(0, 80) : null };
          this.sampledAt = now;
          this.counts = [...this.counts.filter((entry) => now - entry.at <= 5_000), { at: now, count: Math.max(0, value.keyCount) }];
        } catch { /* Ignore non-sample output from PowerShell. */ }
      }
    });
    const failed = (message: string): void => {
      if (this.child !== child) return;
      this.child = null;
      this.sample = null;
      this.retryAfter = Date.now() + 60_000;
      this.onError(message);
    };
    child.on('error', (error) => failed(error.message));
    child.on('exit', (code) => failed(`Windows 场景检测退出 (${code}) ${errors}`));
  }
}

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import type { Settings } from '../shared/types';
import type { ReminderGateDecision } from './reminders';

const MINUTE = 60_000;
const MEETING_APPS = new Set(['zoom', 'teams', 'ms-teams', 'webex', 'slack']);

export interface ForegroundScene {
  appName: string;
  fullScreen: boolean;
}

const FOREGROUND_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace EyeProtect {
  public static class Foreground {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  }
}
'@
Add-Type -AssemblyName System.Windows.Forms
$handle = [EyeProtect.Foreground]::GetForegroundWindow()
if ($handle -eq [IntPtr]::Zero) { exit 0 }
$processId = [uint32]0
[void][EyeProtect.Foreground]::GetWindowThreadProcessId($handle, [ref]$processId)
$process = Get-Process -Id $processId -ErrorAction Stop
$rect = New-Object EyeProtect.Foreground+RECT
[void][EyeProtect.Foreground]::GetWindowRect($handle, [ref]$rect)
$bounds = [System.Windows.Forms.Screen]::FromHandle($handle).Bounds
$tolerance = 3
$fullScreen =
  [Math]::Abs($rect.Left - $bounds.Left) -le $tolerance -and
  [Math]::Abs($rect.Top - $bounds.Top) -le $tolerance -and
  [Math]::Abs($rect.Right - $bounds.Right) -le $tolerance -and
  [Math]::Abs($rect.Bottom - $bounds.Bottom) -le $tolerance
@{ appName = $process.ProcessName; fullScreen = $fullScreen } | ConvertTo-Json -Compress
`;

export const detectForegroundScene = (): Promise<ForegroundScene | null> => {
  if (process.platform !== 'win32') {
    return Promise.resolve(null);
  }
  const powershell = join(
    process.env.SystemRoot?.trim() || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  return new Promise((resolve) => {
    execFile(
      powershell,
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', FOREGROUND_SCRIPT],
      { windowsHide: true, timeout: 2_500, maxBuffer: 16 * 1_024 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as Partial<ForegroundScene>;
          const appName =
            typeof parsed.appName === 'string'
              ? parsed.appName.trim().replace(/\.exe$/i, '').toLocaleLowerCase()
              : '';
          resolve(appName ? { appName, fullScreen: parsed.fullScreen === true } : null);
        } catch {
          resolve(null);
        }
      }
    );
  });
};

/**
 * Returns the quiet-hours end only while `now` lies in the configured local
 * interval. Equal start/end means no fixed quiet interval.
 */
export const getQuietHoursEnd = (
  now: number,
  startMinutes: number,
  endMinutes: number
): number | null => {
  if (startMinutes === endMinutes) {
    return null;
  }
  const date = new Date(now);
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  const overnight = startMinutes > endMinutes;
  const active = overnight
    ? minuteOfDay >= startMinutes || minuteOfDay < endMinutes
    : minuteOfDay >= startMinutes && minuteOfDay < endMinutes;
  if (!active) {
    return null;
  }
  const end = new Date(date);
  end.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
  if (overnight && minuteOfDay >= startMinutes) {
    end.setDate(end.getDate() + 1);
  }
  return end.getTime();
};

export const evaluateReminderContext = async (
  settings: Settings,
  now: number = Date.now(),
  detector: () => Promise<ForegroundScene | null> = detectForegroundScene
): Promise<ReminderGateDecision> => {
  if (settings.quietHoursEnabled) {
    const quietEnd = getQuietHoursEnd(
      now,
      settings.quietHoursStartMinutes,
      settings.quietHoursEndMinutes
    );
    if (quietEnd !== null) {
      return {
        action: 'defer',
        deferMinutes: Math.max(1, Math.ceil((quietEnd - now) / MINUTE)),
        reason: '当前处于固定免打扰时段',
        foregroundApp: null
      };
    }
  }

  if (!settings.foregroundDetectionEnabled || settings.quietAppWhitelist.length === 0) {
    return { action: 'show' };
  }
  const scene = await detector();
  if (!scene || !settings.quietAppWhitelist.includes(scene.appName)) {
    return { action: 'show' };
  }
  if (MEETING_APPS.has(scene.appName)) {
    return {
      action: 'notify',
      deferMinutes: 5,
      reason: `${scene.appName} 位于前台，已改为系统轻提示`,
      foregroundApp: scene.appName
    };
  }
  return {
    action: 'defer',
    deferMinutes: 5,
    reason: scene.fullScreen
      ? `${scene.appName} 正在全屏显示`
      : `${scene.appName} 位于前台白名单`,
    foregroundApp: scene.appName
  };
};

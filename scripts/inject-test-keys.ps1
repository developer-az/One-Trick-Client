# Sends Page Up + Page Down once (for onetrick-keys.exe integration tests).
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class OTKeyInject {
  public const byte VK_PRIOR = 0x21;
  public const byte VK_NEXT = 0x22;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void Tap(byte vk) {
    keybd_event(vk, 0, 0, UIntPtr.Zero);
    keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }
}
"@
Start-Sleep -Milliseconds 200
[OTKeyInject]::Tap([OTKeyInject]::VK_PRIOR)
Start-Sleep -Milliseconds 250
[OTKeyInject]::Tap([OTKeyInject]::VK_NEXT)

; Clean up shortcuts from Pyke Dominator / old package-name installs when upgrading in place.
!macro customInstall
  Delete "$DESKTOP\Pyke Dominator.lnk"
  Delete "$DESKTOP\pyke-dominator.lnk"
  RMDir /r "$SMPROGRAMS\Pyke Dominator"
  RMDir /r "$SMPROGRAMS\pyke-dominator"

  ; One Trick has never created an "OneTrickLink" shortcut and registers no OneTrickLink/otclink
  ; protocol, so any such shortcut is left over from an older, foreign install and points at a
  ; target that no longer exists.
  ; Trigger: every installer run, upgrade or fresh install. Delete/RMDir/reg delete are silent
  ; no-ops when the target is absent, so nothing needs (or has) a guard here. Do not reintroduce
  ; an isUpdated guard: that flag is only set by electron-updater, which this app does not ship,
  ; so the block would never run for a user who installs a newer build over an older one.
  Delete "$DESKTOP\OneTrickLink.lnk"
  Delete "$DESKTOP\OneTrickLink.lnk.lnk"
  ; The old Start Menu group carried the same stale link, and a foreign launcher can also
  ; land directly in the Start Menu root.
  Delete "$SMPROGRAMS\OneTrick\OneTrickLink.lnk"
  Delete "$SMPROGRAMS\OneTrickLink.lnk"
  ; Drop that group only if it is now empty: no /r, so unrelated user entries keep it alive.
  ; Never touch our real shortcuts: with no menuCategory they are the bare links
  ; "$SMPROGRAMS\One Trick.lnk" and "$DESKTOP\One Trick.lnk" (not a Start Menu folder).
  ; Note: pinned Start/taskbar tiles are not cleaned by deleting the .lnk file; WinShell::UninstShortcut
  ; would be needed for that parity, left as a known limitation.
  RMDir "$SMPROGRAMS\OneTrick"

  ; Remove a legacy OneTrickLink URL-protocol registration if one exists. Keep it user-scoped:
  ; this is a per-user install (allowElevation false), and HKLM was never ours to change.
  ; nsExec::ExecToLog hides the console; the pipe into echo. makes cmd exit 0 even when the key
  ; is missing, so a stale/absent protocol can never fail the install. No guard is needed for the
  ; same reason as the shortcut deletes above.
  nsExec::ExecToLog 'cmd /c reg delete "HKCU\Software\Classes\OneTrickLink" /f | echo.'
  Pop $0
  nsExec::ExecToLog 'cmd /c reg delete "HKCU\Software\Classes\otclink" /f | echo.'
  Pop $0
!macroend

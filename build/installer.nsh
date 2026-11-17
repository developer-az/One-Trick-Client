; Clean up shortcuts from Pyke Dominator / old package-name installs when upgrading in place.
!macro customInstall
  Delete "$DESKTOP\Pyke Dominator.lnk"
  Delete "$DESKTOP\pyke-dominator.lnk"
  RMDir /r "$SMPROGRAMS\Pyke Dominator"
  RMDir /r "$SMPROGRAMS\pyke-dominator"

  ; One Trick has never created an "OneTrickLink" shortcut and registers no OneTrickLink/otclink
  ; protocol, so any such shortcut is left over from an older, foreign install and points at a
  ; target that no longer exists. Delete on upgrade; Delete is a no-op when the file is absent.
  Delete "$DESKTOP\OneTrickLink.lnk"
  Delete "$DESKTOP\OneTrickLink.lnk.lnk"
  Delete "$DESKTOP\One Trick Link.lnk"
  ; The old Start Menu group carried the same stale link.
  Delete "$SMPROGRAMS\OneTrick\OneTrickLink.lnk"
  ; Drop that group only if it is now empty: no /r, so unrelated user entries keep it alive.
  ; Never touch "$SMPROGRAMS\One Trick" — electron-builder writes our real shortcuts there.
  RMDir "$SMPROGRAMS\OneTrick"

  ; Remove a legacy OneTrickLink URL-protocol registration if one exists. Keep it user-scoped:
  ; this is a per-user install (allowElevation false), and HKLM was never ours to change.
  ; nsExec::ExecToLog hides the console; the pipe into echo. makes cmd exit 0 even when the key
  ; is missing, so a stale/absent protocol can never fail the install.
  nsExec::ExecToLog 'cmd /c reg delete "HKCU\Software\Classes\OneTrickLink" /f | echo.'
  Pop $0
  nsExec::ExecToLog 'cmd /c reg delete "HKCU\Software\Classes\otclink" /f | echo.'
  Pop $0
!macroend

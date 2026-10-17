; Clean up shortcuts from Pyke Dominator / old package-name installs when upgrading in place.
!macro customInstall
  Delete "$DESKTOP\Pyke Dominator.lnk"
  Delete "$DESKTOP\pyke-dominator.lnk"
  RMDir /r "$SMPROGRAMS\Pyke Dominator"
  RMDir /r "$SMPROGRAMS\pyke-dominator"
!macroend

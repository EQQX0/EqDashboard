; Finish page with two ticked boxes: open the app, and add a desktop shortcut. The person chooses.
!macro customFinishPage
  Function LaunchApp
    Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  FunctionEnd
  Function AddDesktopShortcut
    CreateShortCut "$DESKTOP\${PRODUCT_FILENAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  FunctionEnd
  !define MUI_FINISHPAGE_RUN ""
  !define MUI_FINISHPAGE_RUN_TEXT "Open Samsung Server"
  !define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Add a shortcut to the desktop"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION AddDesktopShortcut
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnInstall
  Delete "$DESKTOP\${PRODUCT_FILENAME}.lnk"
!macroend

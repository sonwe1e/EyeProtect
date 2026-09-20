!include "LogicLib.nsh"
!include "getProcessInfo.nsh"
Var pid

!macro preserveEyeProtectData
  IfFileExists "$INSTDIR\data\*.*" 0 eyeprotect_data_migration_done
  IfFileExists "$APPDATA\eye-protect-pet\data\*.*" eyeprotect_data_migration_done 0

  CreateDirectory "$APPDATA\eye-protect-pet"
  RMDir /r "$APPDATA\eye-protect-pet\data-upgrade-staging"
  CreateDirectory "$APPDATA\eye-protect-pet\data-upgrade-staging"

  nsExec::ExecToStack '"$SYSDIR\robocopy.exe" "$INSTDIR\data" "$APPDATA\eye-protect-pet\data-upgrade-staging" /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /XJ /NFL /NDL /NJH /NJS /NP'
  Pop $0
  Pop $1
  ${If} $0 >= 8
    RMDir /r "$APPDATA\eye-protect-pet\data-upgrade-staging"
    MessageBox MB_ICONSTOP|MB_OK "EyeProtect could not preserve the existing data directory. Installation was stopped and the original data remains unchanged."
    Abort
  ${EndIf}

  ClearErrors
  Rename "$APPDATA\eye-protect-pet\data-upgrade-staging" "$APPDATA\eye-protect-pet\data"
  IfErrors 0 eyeprotect_data_migration_done
    RMDir /r "$APPDATA\eye-protect-pet\data-upgrade-staging"
    MessageBox MB_ICONSTOP|MB_OK "EyeProtect could not activate the migrated data directory. Installation was stopped and the original data remains unchanged."
    Abort

  eyeprotect_data_migration_done:
!macroend

!macro customCheckAppRunning
  !insertmacro _CHECK_APP_RUNNING
  !insertmacro preserveEyeProtectData
!macroend

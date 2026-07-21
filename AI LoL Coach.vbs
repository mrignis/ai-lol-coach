' Launches the coach with no console window.
' electron.exe is a GUI-subsystem binary, so it never creates a console —
' the black window only ever came from going through cmd.exe / npm.
' Window style MUST be 1 (normal): style 0 is inherited by Chromium via
' STARTUPINFO and would make every app window start invisible.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
electron = here & "\node_modules\electron\dist\electron.exe"
If fso.FileExists(electron) Then
  sh.Run """" & electron & """ """ & here & """", 1, False
Else
  MsgBox "Electron not found. Run 'npm install' in:" & vbCrLf & here, 16, "AI LoL Coach"
End If

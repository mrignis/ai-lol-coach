' Launches the coach with NO console window (window style 0 = hidden).
' Double-click this instead of the old .bat files.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
electron = here & "\node_modules\electron\dist\electron.exe"
If fso.FileExists(electron) Then
  sh.Run """" & electron & """ """ & here & """", 0, False
Else
  MsgBox "Electron not found. Run 'npm install' in:" & vbCrLf & here, 16, "AI LoL Coach"
End If

on matchesButton(buttonName)
  set acceptedNames to {"Allow", "Allow Always", "Approve", "Accept", "Continue"}
  return buttonName is in acceptedNames
end matchesButton

on clickButtonIn(element)
  tell application "System Events"
    try
      set elementRole to role of element as text
      if elementRole is "AXButton" then
        set buttonName to name of element as text
        if my matchesButton(buttonName) then
          perform action "AXPress" of element
          return buttonName
        end if
      end if
      repeat with childElement in (UI elements of element)
        set clickedName to my clickButtonIn(childElement)
        if clickedName is not "" then return clickedName
      end repeat
    end try
  end tell
  return ""
end clickButtonIn

on run
  try
    tell application "System Events"
      if not (exists process "Code") then return "button-not-found"
      repeat with codeWindow in (windows of process "Code")
        set clickedName to my clickButtonIn(codeWindow)
        if clickedName is not "" then return clickedName
      end repeat
    end tell
    return "button-not-found"
  on error errorMessage
    return "error:" & errorMessage
  end try
end run

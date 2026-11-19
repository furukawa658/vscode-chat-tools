#!/usr/bin/env python3
import json
import sys

ACCEPTED_NAMES = {"Allow", "Allow Always", "Approve", "Accept", "Continue"}


def visit(element):
    try:
        name = element.name or ""
        if element.getRole() == pyatspi.ROLE_PUSH_BUTTON and name in ACCEPTED_NAMES:
            for index in range(element.get_n_actions()):
                if element.getActionName(index) in {"click", "press"}:
                    if element.doAction(index):
                        return name
        for child_index in range(element.childCount):
            clicked = visit(element.getChildAtIndex(child_index))
            if clicked:
                return clicked
    except Exception:
        pass
    return ""


try:
    import pyatspi
except Exception as error:
    print(json.dumps({"clicked": False, "reason": f"pyatspi unavailable: {error}"}))
    sys.exit(2)

try:
    desktop = pyatspi.Registry.getDesktop(0)
    for app_index in range(desktop.childCount):
        application = desktop.getChildAtIndex(app_index)
        if (application.name or "").lower() not in {"code", "code - insiders", "visual studio code"}:
            continue
        clicked = visit(application)
        if clicked:
            print(json.dumps({"clicked": True, "button": clicked}))
            sys.exit(0)
    print(json.dumps({"clicked": False, "reason": "button-not-found"}))
    sys.exit(1)
except Exception as error:
    print(json.dumps({"clicked": False, "reason": str(error)}))
    sys.exit(2)

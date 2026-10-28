#!/usr/bin/env python3
"""Package MonthGrid as a pbw that uses the Pebble app's permissions.

The Pebble app treats a pbw without `manifestVersion: 2` in its appinfo as a
legacy app: it ignores `usesPermissions` and gives it only what apps had
before permissions (internet, location). Reading `calendar/event` (the Next
calendar event item) needs the `Calendar` permission, which only a
manifestVersion 2 app can declare. SDK 4.33.1's `pebble build` copies the
`pebble` block of package.json (`usesPermissions` included) into appinfo.json
but never sets manifestVersion, so this rewrites appinfo.json in a copy of the
built pbw and leaves the normal pbw untouched.

    python3 tools/pack_plugins_pbw.py            # pebble build, then pack
    python3 tools/pack_plugins_pbw.py --no-build # pack the existing build

Writes build/monthgrid-plugins.pbw.
"""

import json
import os
import subprocess
import sys
import zipfile

MANIFEST_VERSION = 2
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILT = os.path.join(ROOT, "build", "monthgrid.pbw")
OUT = os.path.join(ROOT, "build", "monthgrid-plugins.pbw")

# The Pebble app's built-in permission names (plugins.md, "Declaring").
KNOWN = {
    "Internet", "LocalNetwork", "Location", "Microphone", "Notifications", "Calendar",
    "Contacts", "Timeline", "ReadWatchSettings", "WriteWatchSettings", "ReadMusic",
    "ControlMusic", "LaunchApps", "FindMyPhone", "ReadFiles", "WriteFiles",
    "LegacyPebbleKit", "Health",
}


def permission_name(entry):
    return entry if isinstance(entry, str) else entry.get("name", "")


def check_permissions(permissions):
    if not isinstance(permissions, list) or not permissions:
        sys.exit("package.json declares no usesPermissions; nothing to pack")
    for entry in permissions:
        name = permission_name(entry)
        if name not in KNOWN and not (isinstance(entry, dict) and entry.get("plugin")):
            sys.exit(f"unknown permission '{name}' in usesPermissions")
        if name == "Internet":
            domains = (entry.get("parameters") or {}).get("domains") if isinstance(entry, dict) else None
            if not domains:
                sys.exit("Internet must name its domains; bare Internet is refused for "
                         "manifestVersion 2 apps")


def main(argv):
    if "--no-build" not in argv:
        # waf doesn't always re-zip when only appinfo changes; start clean.
        if os.path.exists(BUILT):
            os.remove(BUILT)
        subprocess.run(["pebble", "build"], cwd=ROOT, check=True)
    if not os.path.exists(BUILT):
        sys.exit(f"{BUILT} is missing; run pebble build first")

    with open(os.path.join(ROOT, "package.json")) as f:
        declared = json.load(f)["pebble"].get("usesPermissions")

    with zipfile.ZipFile(BUILT) as z:
        appinfo = json.loads(z.read("appinfo.json"))
        entries = [(info, z.read(info)) for info in z.infolist() if info.filename != "appinfo.json"]

    if appinfo.get("usesPermissions") != declared:
        # Older SDKs may drop unknown keys; package.json is the source of truth.
        appinfo["usesPermissions"] = declared
    check_permissions(appinfo["usesPermissions"])
    appinfo["manifestVersion"] = MANIFEST_VERSION

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("appinfo.json", json.dumps(appinfo, indent=2))
        for info, data in entries:
            z.writestr(info, data)

    names = ", ".join(permission_name(p) for p in appinfo["usesPermissions"])
    print(f"packed {os.path.relpath(OUT, ROOT)} (manifestVersion {MANIFEST_VERSION}; {names})")


if __name__ == "__main__":
    main(sys.argv[1:])

# Publishing MonthGrid manually

Roger publishes every app-store update himself. Agents prepare and verify the files, copy,
screenshots, and instructions; they do not upload releases or publish listing changes.
GitHub releases are separate and may be published when requested.

## MonthGrid 1.5.0

- [GitHub release and downloads](https://github.com/OkGoDoIt/pebble-monthgrid/releases/tag/v1.5.0)
- Store binary: `monthgrid.pbw`, the same file for both stores. Built with SDK 4.44, so it
  declares its permissions (`manifestVersion` 2): Calendar, Location, Health, and Internet for
  Open-Meteo and the common calendar hosts, each optional and with a reason. There is no
  separate plugins build any more.
- Store screenshots: `screenshots/releases/1.5.0/<platform>/`, two native-resolution captures
  from each of the seven SDK emulators. All calendar and battery values are synthetic.
- Description and release notes: `docs/releases/1.5.0-description.txt` and
  `docs/releases/1.5.0-release-notes.txt`. The stores are on 1.2.0 (1.4.0 was never
  submitted), so the notes cover everything since then.
- UUID stays `45829fc0-2bd8-4b99-a273-1cd63d8f5ef5`. Update the existing listing.

Existing users updating from 1.2.0 are asked again for what they use: the Pebble app drops a
legacy app's old access when it moves to declared permissions. Every permission is optional, so
the update installs without waiting and asks the first time each one is used.

## Core Devices Pebble Appstore

1. Open the [developer dashboard](https://developer.repebble.com/dashboard) and sign in with
   the account that owns MonthGrid.
2. Select the existing MonthGrid listing (ID `865c44435a054e288357979f`).
3. Create its next release, upload `monthgrid.pbw`, and use version **1.5.0**.
4. Paste the release notes. Update the description with the supplied text if desired.
5. In each platform's screenshot collection, upload the two PNGs from the matching platform
   folder. Keep any existing screenshots you still want, within the portal's per-platform limit.
6. Review the release and listing, then publish when ready.
7. Check the [live Pebble listing](https://apps.repebble.com/865c44435a054e288357979f).

The dashboard requires sign-in, so its exact current release-button wording was not verified
for this handoff. No store account was signed in and no release was submitted by the agent.

## Rebble Appstore

1. Open the [Rebble Developer Portal](https://dev-portal.rebble.io/) and sign in.
2. Select MonthGrid (ID `6a94c275784eb40009a8abdd`) and choose **New Release**.
3. Paste the supplied release notes and select `monthgrid.pbw` for **App Binary**.
4. Review and choose **Publish release to Store** when ready.
5. For the description, use **Edit Store Listing**, paste the supplied text, and choose
   **Update & Publish**. Update each platform's screenshots in its asset collection.
6. Check the [live Rebble listing](https://apps.rebble.io/en_US/application/6a94c275784eb40009a8abdd).

Rebble screenshot changes take effect immediately. The two stores are separate submissions.

## Screenshot sizes

| Folder | Watch | Size |
|---|---|---|
| aplite | Pebble / Steel | 144 × 168 |
| basalt | Pebble Time / Time Steel | 144 × 168 |
| chalk | Pebble Time Round | 180 × 180 |
| diorite | Pebble 2 | 144 × 168 |
| emery | Pebble Time 2 | 200 × 228 |
| flint | Pebble 2 Duo | 144 × 168 |
| gabbro | Pebble Round 2 | 260 × 260 |

`1_next_event.png` shows the event layout and battery readings that fit each watch.
`2_weather_range.png` shows Pixel time and the weather range. Narrow and round screens adapt
what fits. Upload the PNGs without frames or resizing. Phone settings screenshots are review
material, not watch-store screenshots.

To regenerate after building: `python3 tools/capture_release_screenshots.py screenshots/releases/1.5.0`.
This changes emulator state only and never connects to a phone.

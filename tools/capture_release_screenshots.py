#!/usr/bin/env python3
"""Capture synthetic release scenes from the actual SDK emulators.

Run after `pebble build`. Only emulator state is changed; no phone is contacted.
"""
import argparse
import datetime
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--platforms", nargs="+", default=[
        "aplite", "basalt", "chalk", "diorite", "emery", "flint", "gabbro"])
    args = parser.parse_args()
    keys = {name: int(value) for name, value in re.findall(
        r"MESSAGE_KEY_(\w+) = (\d+);",
        (ROOT / "build/src/message_keys.auto.c").read_text())}

    for platform in args.platforms:
        out = args.output.resolve() / platform
        out.mkdir(parents=True, exist_ok=True)

        def run(command, *arguments):
            subprocess.run(["pebble", command, "--emulator", platform, *map(str, arguments)],
                           cwd=ROOT, check=True, stdout=subprocess.DEVNULL)

        def message(integers, strings=None, metrics=None):
            argv = ["--int", *[f"{keys[key]}={value}" for key, value in integers.items()]]
            if strings:
                argv += ["--string", *[f"{keys[key]}={value}" for key, value in strings.items()]]
            if metrics:
                argv += ["--bytes", f"{keys['METRICS']}={bytes(metrics).hex()}"]
            run("send-app-message", *argv)

        run("install", ROOT / "build/monthgrid.pbw")
        # Each SDK connection synchronizes the clock, so events use the current time.
        now = int(datetime.datetime.now().timestamp())
        run("emu-battery", "--percent", 90)
        message({
            "THEME": 3, "TIME_FORMAT": 1, "TIME_SIZE": 0, "TIME_FONT": 0,
            "SHOW_SECONDS": 0, "START_DAY": 0, "SHOW_ADJACENT": 0,
            "DOTS_ENABLED": 0, "GRID_LINES": 0, "BANNER_CONTENT": 0,
            "BANNER_STYLE": 0, "HEADER_LABEL": 0, "TEMP_UNIT": 1,
            "BATTERY_BELOW": 100, "PHONE_BATTERY_BELOW": 100,
            "WEATHER_DETAIL": 0, "WEATHER_TEMP_DC": 133, "WEATHER_COND": 1,
            "PHONE_BATTERY": 64, "EVENT_PLACE": 2, "EVENT_WITHIN": 60,
            "EVENT_STYLE": 0, "EVENT_START": now + 12 * 60,
            "EVENT_END": now + 42 * 60, "EVENT_ALL_DAY": 0,
        }, {"EVENT_NAME": "Standup"}, [1, 14, 2])
        run("screenshot", "--no-open", out / "1_next_event.png")
        message({
            "THEME": 0, "TIME_FONT": 2, "EVENT_PLACE": 0,
            "WEATHER_DETAIL": 1, "FC_HIGH_DC": 178, "FC_LOW_DC": 89,
        }, metrics=[2, 1])
        run("screenshot", "--no-open", out / "2_weather_range.png")
        print(f"Captured {platform}", flush=True)


if __name__ == "__main__":
    main()

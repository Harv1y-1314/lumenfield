#!/usr/bin/env python3
"""DE440s 参照取样器 —— 本仓历算核心的外部对照。

为什么要有这个脚本：光野的天文部分全部是本地近似算法（Schlyter 轨道要素 +
Meeus 简化恒星时），界面再漂亮也可能是错的。这个脚本用 JPL DE440s 数值历表
（Skyfield 读取）在若干时刻与若干站点取样，落成 tests/fixtures/de440s.json，
供离线测试断言用；改算法后重跑一次即可看偏差有没有变大。

依赖（只装在临时环境，不进仓）：
    python3 -m venv /tmp/skyenv && /tmp/skyenv/bin/pip install skyfield
    /tmp/skyenv/bin/python tools/reference/skyfield_check.py
历表 de440s.bsp 由 Skyfield 自动下载到 --data-dir（约 2.1 MB，NASA 公开件）。
"""
import argparse
import json
import os
from datetime import datetime, timedelta, timezone

import numpy as np
from skyfield import almanac
from skyfield.api import Angle, Loader, Star, Topos

SITES = {
    "beijing": {"name": "北京", "lat": 39.9042, "lon": 116.4074, "height_m": 44, "tz": 480},
    "lhasa": {"name": "纳木错（西藏）", "lat": 30.7520, "lon": 90.9309, "height_m": 4718, "tz": 480},
    "tromso": {"name": "特罗姆瑟", "lat": 69.6492, "lon": 18.9553, "height_m": 50, "tz": 120},
}
# 取样时刻：银河季子夜、当下、冬至正午（覆盖高纬极夜与赤纬极端）
EPOCHS = ["2026-07-16T00:00:00+08:00", "2026-10-19T12:00:00+08:00", "2026-12-21T12:00:00+08:00"]
CORE_J2000 = {"ra_deg": 266.4168, "dec_deg": -28.9370}      # 银心 / 人马 A* 方向
VEGA_J2000 = {"ra_deg": 279.2347, "dec_deg": 38.7837}
BODIES = ["sun", "moon", "mercury", "venus", "mars barycenter", "jupiter barycenter", "saturn barycenter"]
STEP_MIN = 1


def make_star(spec):
    return Star(ra=Angle(degrees=spec["ra_deg"]), dec=Angle(degrees=spec["dec_deg"]))


def topos(site):
    return Topos(f"{abs(site['lat'])} {'N' if site['lat'] >= 0 else 'S'}",
                 f"{abs(site['lon'])} {'E' if site['lon'] >= 0 else 'W'}",
                 elevation_m=site["height_m"])


def crossings(alt_deg, threshold, grid):
    up = alt_deg >= threshold
    idx = np.where(up[1:] != up[:-1])[0]
    return [{"time": grid[int(i) + 1].utc_strftime("%Y-%m-%dT%H:%M:%SZ"),
             "rising": bool(up[int(i) + 1])} for i in idx]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=os.path.join(os.environ.get("TMPDIR", "/tmp"), "skydata"))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..",
                                                  "tests", "fixtures", "de440s.json"))
    args = ap.parse_args()

    os.makedirs(args.data_dir, exist_ok=True)
    load = Loader(args.data_dir)
    ts = load.timescale()
    planets = load("de440s.bsp")
    out = {
        "provenance": {
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "tool": "skyfield + JPL de440s.bsp",
            "sampling_grid_minutes": STEP_MIN,
            "note": "升落时刻按 1 分钟网格检出，测试容差取 150 秒；位置量取瞬时值，"
                     "altaz 默认不折光，与本地几何高度对齐",
        },
        "sites": SITES,
        "epochs": [],
        "moon_phases": [],
    }

    for iso in EPOCHS:
        dt = datetime.fromisoformat(iso).astimezone(timezone.utc)
        t = ts.utc(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second)
        # 以取样时刻为中心取 44 小时网格，够覆盖该民用日的升落与晨昏
        count = int(44 * 60 / STEP_MIN) + 1
        stamps = [dt - timedelta(hours=24) + timedelta(minutes=STEP_MIN * i) for i in range(count)]
        grid = ts.utc([s.year for s in stamps], [s.month for s in stamps], [s.day for s in stamps],
                      [s.hour for s in stamps], [s.minute for s in stamps],
                      [s.second + s.microsecond / 1e6 for s in stamps])
        entry = {"iso": iso, "geocentric": {}, "topocentric": {}, "events": {}}
        for key in BODIES:
            ast = planets["earth"].at(t).observe(planets[key]).apparent()
            ra, dec, dist = ast.radec(t)
            lat, lon = ast.ecliptic_latlon(epoch="date")[:2]
            entry["geocentric"][key] = {
                "ra": float(ra.degrees), "dec": float(dec.degrees),
                "ecl_lon": float(lon.degrees), "ecl_lat": float(lat.degrees),
                "dist_km": float(dist.km)}
        for sid, site in SITES.items():
            obs = planets["earth"] + topos(site)
            for label, body in [("sun", planets["sun"]), ("moon", planets["moon"]),
                                 ("galactic_core", make_star(CORE_J2000)),
                                 ("vega", make_star(VEGA_J2000))]:
                aa = obs.at(t).observe(body).apparent().altaz()
                entry["topocentric"].setdefault(sid, {})[label] = {
                    "alt": float(np.degrees(aa[0].radians)),
                    "az": float(np.degrees(aa[1].radians))}
            def alts(body):
                aa = obs.at(grid).observe(body).apparent().altaz()
                return np.degrees(aa[0].radians)
            ev = {
                "sun_-0.833": crossings(alts(planets["sun"]), -0.833, grid),
                "civil_-6": crossings(alts(planets["sun"]), -6.0, grid),
                "nautical_-12": crossings(alts(planets["sun"]), -12.0, grid),
                "astronomical_-18": crossings(alts(planets["sun"]), -18.0, grid),
                "moon_+0.125": crossings(alts(planets["moon"]), 0.125, grid),
                "core_0": crossings(alts(make_star(CORE_J2000)), 0.0, grid),
            }
            entry["events"][sid] = ev
        out["epochs"].append(entry)
        print("epoch done:", iso)

    tm, tp = almanac.find_discrete(ts.utc(2026, 9, 25), ts.utc(2026, 11, 10),
                                   almanac.moon_phases(planets))
    names = ["new", "first_quarter", "full", "last_quarter"]
    for t, i in zip(tm, tp):
        out["moon_phases"].append({"time": t.utc_strftime("%Y-%m-%dT%H:%M:%SZ"),
                                   "phase": names[int(i)]})

    path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("written:", path, "epochs:", len(out["epochs"]), "phases:", len(out["moon_phases"]))


if __name__ == "__main__":
    main()

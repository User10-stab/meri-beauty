#!/usr/bin/env python
"""Minimal OWASP ZAP driver: spider + passive (optionally active) scan.

Talks to a ZAP daemon's JSON API over HTTP. No third-party dependencies.
Intended to be launched by scripts/security/zap-scan.ps1.
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime


def api(base, path, params=None, timeout=60):
    url = base + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def wait_for_zap(base, attempts=60, delay=3):
    for i in range(attempts):
        try:
            v = api(base, "/core/view/version/", timeout=5)
            return v["version"]
        except Exception:
            time.sleep(delay)
    raise SystemExit("ZAP API did not respond")


def escape(text):
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def write_html(path, target, alerts):
    risk_color = {
        "High": "#d32f2f",
        "Medium": "#f57c00",
        "Low": "#fbc02d",
        "Informational": "#0288d1",
    }
    rows = []
    for a in alerts:
        color = risk_color.get(a.get("risk"), "#666")
        rows.append(
            "<tr>"
            f"<td style='color:{color};font-weight:bold'>{escape(a.get('risk'))}</td>"
            f"<td>{escape(a.get('alert'))}</td>"
            f"<td>{escape(a.get('confidence'))}</td>"
            f"<td>{escape(a.get('url'))}</td>"
            f"<td>{escape(a.get('param'))}</td>"
            f"<td>{escape(a.get('evidence'))}</td>"
            "</tr>"
        )
    doc = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>ZAP report - {escape(target)}</title></head>
<body>
<h1>OWASP ZAP report</h1>
<p>Target: {escape(target)}<br>Generated: {datetime.utcnow().isoformat()}Z<br>
Alerts: {len(alerts)}</p>
<table border="1" cellpadding="6" cellspacing="0">
<tr><th>Risk</th><th>Alert</th><th>Confidence</th><th>URL</th><th>Param</th><th>Evidence</th></tr>
{''.join(rows)}
</table>
</body></html>"""
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(doc)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("-t", "--target", required=True)
    p.add_argument("-p", "--port", type=int, default=8090)
    p.add_argument("-J", "--json-out")
    p.add_argument("-r", "--html-out")
    p.add_argument("-m", "--spider-minutes", type=int, default=2)
    p.add_argument("-a", "--active", action="store_true")
    args = p.parse_args()

    base = f"http://127.0.0.1:{args.port}/JSON"
    version = wait_for_zap(base)
    print(f"  connected to ZAP {version}")

    print("  spidering...")
    sid = api(base, "/spider/action/scan/", {"url": args.target, "recurse": "true"})["scan"]
    deadline = time.time() + args.spider_minutes * 60
    while time.time() < deadline:
        status = int(api(base, "/spider/view/status/", {"scanId": sid})["status"])
        if status >= 100:
            break
        time.sleep(2)
    print(f"  spider complete ({status}%)")

    print("  passive scanning...")
    time.sleep(3)
    stable = 0
    for _ in range(300):
        left = int(api(base, "/pscan/view/recordsToScan/", {})["recordsToScan"])
        if left == 0:
            stable += 1
            if stable >= 3:
                break
        else:
            stable = 0
        time.sleep(2)

    if args.active:
        print("  active scanning (this can take a while)...")
        asid = api(base, "/ascan/action/scan/", {"url": args.target, "recurse": "true"})["scan"]
        while int(api(base, "/ascan/view/status/", {"scanId": asid})["status"]) < 100:
            time.sleep(3)

    alerts = api(base, "/core/view/alerts/", {"start": "0", "count": "5000"})["alerts"]
    alerts = [a for a in alerts if a.get("url", "").startswith(args.target)]
    by_risk = {}
    for a in alerts:
        by_risk[a.get("risk", "?")] = by_risk.get(a.get("risk", "?"), 0) + 1
    print("  alerts: " + ", ".join(f"{k}={v}" for k, v in sorted(by_risk.items())))
    for a in sorted(alerts, key=lambda x: x.get("risk", "")):
        print(f"    [{a.get('risk')}] {a.get('alert')} - {a.get('url')}")

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "target": args.target,
                    "generated": datetime.utcnow().isoformat() + "Z",
                    "zapVersion": version,
                    "alertCount": len(alerts),
                    "byRisk": by_risk,
                    "alerts": alerts,
                },
                fh,
                indent=2,
            )
    if args.html_out:
        write_html(args.html_out, args.target, alerts)

    return 0


if __name__ == "__main__":
    sys.exit(main())

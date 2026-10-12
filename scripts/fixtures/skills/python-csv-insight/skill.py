import json
import sys

from tabulate import tabulate


def read_payload():
    if len(sys.argv) > 1:
        try:
            return json.loads(sys.argv[1])
        except Exception:
            pass
    try:
        return json.loads(sys.stdin.read() or "{}")
    except Exception:
        return {}


def main():
    payload = read_payload()
    rows = payload.get("rows") or [
        ["指标", "数值"],
        ["播放量", "12.4 万"],
        ["完播率", "38%"],
    ]
    header = rows[0]
    body = rows[1:] or [["无数据", "-"]]
    table = tabulate(body, headers=header, tablefmt="github")
    print(json.dumps({"ok": True, "table": table}, ensure_ascii=False))


if __name__ == "__main__":
    main()

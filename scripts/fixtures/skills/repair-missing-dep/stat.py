import json
import sys
from collections import Counter

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
    comments = payload.get("comments") or ["可机洗 显瘦", "显瘦 保暖", "保暖"]
    counter = Counter()
    for line in comments:
        for word in str(line).split():
            counter[word] += 1
    rows = counter.most_common(10)
    table = tabulate(rows, headers=["热词", "出现次数"], tablefmt="github")
    print(json.dumps({"ok": True, "table": table}, ensure_ascii=False))


if __name__ == "__main__":
    main()

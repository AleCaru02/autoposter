#!/usr/bin/env python3
"""Fail-closed Buffer scheduler for one personal LinkedIn profile. Python stdlib only."""
import argparse
import hashlib
import json
import os
import re
import sys
import unicodedata
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
BANK = HERE / "posts.json"
STATE = HERE / "state.json"
API = "https://api.buffer.com"
ORDER = ("property", "network", "digital", "personal")
FORBIDDEN = re.compile(
    r"\b(?:operaio|operai|fabbrica|fidanzata|fidanzato|morosa|moroso|mia ragazza|"
    r"il mio ragazzo|relazione sentimentale|vita sentimentale)\b",
    re.IGNORECASE,
)


def normalized(text):
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def digest(text):
    return hashlib.sha256(normalized(text).encode("utf-8")).hexdigest()


def load_bank():
    bank = json.loads(BANK.read_text(encoding="utf-8"))
    policy = bank.get("policy", {})
    if tuple(policy.get("categories_order", ())) != ORDER:
        raise ValueError("Editorial cycle must contain the four categories in order")
    if policy.get("posting_interval_days") != 3 or policy.get("timezone") != "Europe/Rome":
        raise ValueError("Unexpected posting interval or timezone")
    if policy.get("hour") != "09:00":
        raise ValueError("Unexpected posting time")
    date.fromisoformat(policy["first_publish_local_date"])
    categories = bank.get("categories", {})
    if set(categories) != set(ORDER):
        raise ValueError("Only the four authorized categories are allowed")
    sizes = [len(categories[c]) for c in ORDER]
    if not sizes[0] or len(set(sizes)) != 1:
        raise ValueError("Each category must have the same nonzero number of posts")
    seen = set()
    for category in ORDER:
        for post in categories[category]:
            if not isinstance(post, str) or len(post.strip()) < 100:
                raise ValueError(f"Empty or too short post in {category}")
            if FORBIDDEN.search(post):
                raise ValueError(f"Forbidden personal topic in {category}")
            key = digest(post)
            if key in seen:
                raise ValueError("Duplicate text in editorial bank")
            seen.add(key)
    return bank


def load_state():
    if not STATE.exists():
        return {"version": 1, "records": []}
    result = json.loads(STATE.read_text(encoding="utf-8"))
    if result.get("version") != 1 or not isinstance(result.get("records"), list):
        raise ValueError("Unrecognized publication ledger; stopping to protect history")
    return result


def save_state(state):
    temp = STATE.with_suffix(".json.tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(STATE)


def slot(index, bank):
    category = ORDER[index % len(ORDER)]
    position = index // len(ORDER)
    entries = bank["categories"][category]
    if position >= len(entries):
        raise IndexError("Editorial bank exhausted")
    day = date.fromisoformat(bank["policy"]["first_publish_local_date"]) + timedelta(days=3 * index)
    local_due = datetime.combine(day, time(9, 0), tzinfo=ZoneInfo("Europe/Rome"))
    text = entries[position]
    return {
        "slot": index,
        "category": category,
        "hash": digest(text),
        "text": text,
        "due_at": local_due.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def future_slots(bank, now=None, horizon_days=10):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("now must be timezone aware")
    total = len(ORDER) * len(bank["categories"][ORDER[0]])
    due_cutoff = now + timedelta(days=horizon_days)
    result = []
    for i in range(total):
        item = slot(i, bank)
        due = datetime.fromisoformat(item["due_at"].replace("Z", "+00:00"))
        if due <= now + timedelta(minutes=90):
            continue
        if due > due_cutoff:
            break
        result.append(item)
    return result


def graphql(api_key, query):
    request = Request(
        API,
        data=json.dumps({"query": query}, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    try:
        with urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        raise RuntimeError(f"Buffer request failed ({type(error).__name__})") from error
    if result.get("errors") or not isinstance(result.get("data"), dict):
        raise RuntimeError("Buffer returned a GraphQL error; no publishing")
    return result["data"]


def validate_linkedin_channel(api_key, channel_id, expected_name):
    escaped = json.dumps(channel_id)
    data = graphql(api_key, f"""query {{
      channel(input: {{id: {escaped}}}) {{ id displayName service isQueuePaused }}
    }}""")
    ch = data.get("channel")
    if not ch or ch.get("id") != channel_id or str(ch.get("service", "")).lower() != "linkedin":
        raise RuntimeError("Selected Buffer channel is not LinkedIn")
    if ch.get("isQueuePaused") is not False:
        raise RuntimeError("LinkedIn Buffer channel paused or unknown")
    if normalized(ch.get("displayName") or "") != normalized(expected_name):
        raise RuntimeError("LinkedIn channel display name does not match expected account")
    return ch


def remote_history(api_key, org_id, channel_id):
    """Read scheduled + sent posts before every new write, with bounded pagination."""
    all_posts, cursor = [], None
    for _ in range(20):
        after = f"after: {json.dumps(cursor)}," if cursor else ""
        query = f"""query {{
          posts(first: 100, {after} input: {{
            organizationId: {json.dumps(org_id)},
            filter: {{status: [scheduled, sent], channelIds: [{json.dumps(channel_id)}]}}
          }}) {{
            edges {{ node {{ id text channelId dueAt }} }}
            pageInfo {{ hasNextPage endCursor }}
          }}
        }}"""
        data = graphql(api_key, query)
        page = data.get("posts")
        if not isinstance(page, dict):
            raise RuntimeError("Buffer history unavailable; no publishing")
        for entry in page.get("edges", []):
            node = entry.get("node")
            if not node or node.get("channelId") != channel_id:
                raise RuntimeError("Unexpected Buffer history data")
            all_posts.append(node)
        info = page.get("pageInfo") or {}
        if not info.get("hasNextPage"):
            return all_posts
        cursor = info.get("endCursor")
        if not cursor:
            raise RuntimeError("Missing Buffer pagination cursor; no publishing")
    raise RuntimeError("Buffer history exceeds safe scan size; no publishing")


def create_scheduled_post(api_key, channel_id, entry):
    query = f"""mutation {{
      createPost(input: {{
        text: {json.dumps(entry["text"], ensure_ascii=False)},
        channelId: {json.dumps(channel_id)},
        schedulingType: automatic,
        mode: customScheduled,
        dueAt: {json.dumps(entry["due_at"])}
      }}) {{
        ... on PostActionSuccess {{ post {{ id text dueAt }} }}
        ... on MutationError {{ message }}
      }}
    }}"""
    result = graphql(api_key, query).get("createPost")
    if not isinstance(result, dict) or not (result.get("post") or {}).get("id"):
        raise RuntimeError("Buffer did not confirm scheduled post")
    if digest(result["post"].get("text") or "") != entry["hash"]:
        raise RuntimeError("Buffer returned mismatched post; manual reconciliation required")
    return result["post"]["id"]


def run(publish=False, now=None):
    bank, state = load_bank(), load_state()
    active_slots = future_slots(bank, now=now)
    indexed = {}
    used_hashes = set()
    for record in state["records"]:
        idx = record.get("slot")
        key = record.get("hash")
        if not isinstance(idx, int) or idx in indexed or not isinstance(key, str):
            raise ValueError("Ledger corrupted or duplicate slot")
        indexed[idx] = record
        used_hashes.add(key)

    if not publish:
        print(json.dumps({
            "mode": "DRY_RUN", "upcoming": [
                {"slot": e["slot"], "category": e["category"], "due_at": e["due_at"],
                 "state": indexed.get(e["slot"], {}).get("status", "not_scheduled")}
                for e in active_slots
            ], "history_count": len(state["records"]),
            "bank_total": sum(len(bank["categories"][c]) for c in ORDER),
        }, ensure_ascii=False))
        return

    if os.getenv("BUFFER_PUBLISH_ENABLED") != "true":
        raise RuntimeError("Buffer publishing must be explicitly enabled")
    if os.getenv("OTHER_LINKEDIN_AUTOMATION_DISABLED") != "true":
        raise RuntimeError("Another LinkedIn publishing engine may be active; fail closed")
    key = os.environ["BUFFER_API_KEY"]
    channel_id = os.environ["BUFFER_CHANNEL_ID"]
    org_id = os.environ["BUFFER_ORGANIZATION_ID"]
    expected_name = os.environ["BUFFER_EXPECTED_CHANNEL_NAME"].strip()
    if not all((key, channel_id, org_id, expected_name)):
        raise RuntimeError("Missing required Buffer identity settings")
    validate_linkedin_channel(key, channel_id, expected_name)
    remote = remote_history(key, org_id, channel_id)
    remote_hashes = {digest(p.get("text") or ""): p.get("id") for p in remote if p.get("text")}
    remote_ids = {p.get("id"): p for p in remote}
    for record in state["records"]:
        if record.get("status") == "uncertain":
            matched_id = remote_hashes.get(record["hash"])
            if not matched_id:
                raise RuntimeError(
                    f"Slot {record['slot']} has uncertain remote outcome: manual reconciliation required"
                )
            record["buffer_post_id"] = matched_id
            record["status"] = "reconciled_on_buffer"
            save_state(state)
        if record.get("buffer_post_id") in remote_ids:
            if str(remote_ids[record["buffer_post_id"]].get("status", "")).lower() == "sent":
                record["status"] = "sent"
                save_state(state)
    sent_count = 0
    for entry in active_slots:
        i, content_hash = entry["slot"], entry["hash"]
        if i in indexed:
            if indexed[i].get("hash") != content_hash:
                raise RuntimeError("Previously used slot content changed; no publishing")
            continue
        if content_hash in used_hashes:
            raise RuntimeError("Already used editorial text; no repost")
        record = {
            "slot": i, "category": entry["category"], "hash": content_hash,
            "due_at": entry["due_at"], "buffer_post_id": None,
            "status": "uncertain",  # Mark before write; never blindly retry uncertain outcomes.
        }
        if content_hash in remote_hashes:
            record.update(status="already_on_buffer", buffer_post_id=remote_hashes[content_hash])
        else:
            state["records"].append(record)
            save_state(state)
            try:
                post_id = create_scheduled_post(key, channel_id, entry)
            except Exception:
                print(f"POST_OUTCOME_UNCERTAIN: slot={i}; check Buffer before retry", file=sys.stderr)
                raise
            record.update(status="scheduled", buffer_post_id=post_id)
            sent_count += 1
        if record not in state["records"]:
            state["records"].append(record)
        save_state(state)
        indexed[i] = record
        used_hashes.add(content_hash)
    print(json.dumps({
        "mode": "LIVE", "new_scheduled": sent_count,
        "ledger_count": len(state["records"]), "queue_checked": len(remote),
        "bank_remaining": 4 * len(bank["categories"][ORDER[0]]) - len(state["records"]),
    }, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--publish", action="store_true", help="Actually schedule to Buffer; requires explicit safety switches")
    args = parser.parse_args()
    try:
        run(publish=args.publish)
    except Exception as error:
        print(f"STOP: {error}", file=sys.stderr)
        sys.exit(1)

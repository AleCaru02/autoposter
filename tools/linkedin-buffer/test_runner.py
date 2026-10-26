"""Offline tests; no Buffer account, paid API, network, or publishing required."""
import contextlib
import io
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import runner


class EditorialRules(unittest.TestCase):
    def test_exactly_four_equal_categories(self):
        bank = runner.load_bank()
        self.assertEqual(tuple(bank["policy"]["categories_order"]), runner.ORDER)
        self.assertEqual([len(bank["categories"][c]) for c in runner.ORDER], [10, 10, 10, 10])
        all_posts = [runner.slot(n, bank) for n in range(40)]
        self.assertEqual(len({p["hash"] for p in all_posts}), 40)
        for first in range(0, 40, 4):
            self.assertEqual([p["category"] for p in all_posts[first:first+4]], list(runner.ORDER))

    def test_local_9am_every_three_days_including_dst(self):
        bank = runner.load_bank()
        from zoneinfo import ZoneInfo
        prev_day = None
        for n in range(40):
            value = runner.slot(n, bank)
            local = datetime.fromisoformat(value["due_at"].replace("Z", "+00:00")).astimezone(ZoneInfo("Europe/Rome"))
            self.assertEqual((local.hour, local.minute), (9, 0))
            if prev_day is not None:
                self.assertEqual((local.date() - prev_day).days, 3)
            prev_day = local.date()

    def test_exclusions_blocked(self):
        for phrase in ("Sono operaio", "La mia ragazza", "Sono in fabbrica", "La fidanzata"):
            self.assertIsNotNone(runner.FORBIDDEN.search(phrase))

    def test_preview_does_not_require_secret_or_network(self):
        with patch.object(runner, "graphql", side_effect=AssertionError("Network must not be called")):
            with contextlib.redirect_stdout(io.StringIO()) as output:
                runner.run(publish=False, now=datetime(2026, 10, 26, 18, tzinfo=timezone.utc))
        result = json.loads(output.getvalue())
        self.assertEqual(result["mode"], "DRY_RUN")
        self.assertEqual(len(result["upcoming"]), 3)


class SafetyTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.state_path = Path(self.workspace.name) / "state.json"
        patcher = patch.object(runner, "STATE", self.state_path)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.env = patch.dict(os.environ, {
            "BUFFER_PUBLISH_ENABLED": "true",
            "OTHER_LINKEDIN_AUTOMATION_DISABLED": "true",
            "BUFFER_API_KEY": "fake",
            "BUFFER_CHANNEL_ID": "channel",
            "BUFFER_ORGANIZATION_ID": "organization",
            "BUFFER_EXPECTED_CHANNEL_NAME": "Example Account",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.now = datetime(2026, 10, 26, 18, tzinfo=timezone.utc)

    def test_repeated_runs_do_not_duplicate(self):
        with patch.object(runner, "validate_linkedin_channel"), \
             patch.object(runner, "remote_history", return_value=[]), \
             patch.object(runner, "create_scheduled_post", side_effect=lambda _key, _id, post: f"buffer-{post['slot']}") as writer:
            with contextlib.redirect_stdout(io.StringIO()):
                runner.run(publish=True, now=self.now)
                runner.run(publish=True, now=self.now)
        self.assertEqual(writer.call_count, 3)
        state = runner.load_state()
        self.assertEqual(len(state["records"]), 3)
        self.assertEqual([r["status"] for r in state["records"]], ["scheduled"] * 3)

    def test_failed_remote_write_is_not_retried(self):
        with patch.object(runner, "validate_linkedin_channel"), \
             patch.object(runner, "remote_history", return_value=[]), \
             patch.object(runner, "create_scheduled_post", side_effect=TimeoutError("unknown")) as writer:
            with self.assertRaises(TimeoutError), contextlib.redirect_stdout(io.StringIO()), \
                 contextlib.redirect_stderr(io.StringIO()):
                runner.run(publish=True, now=self.now)
            self.assertEqual(runner.load_state()["records"][0]["status"], "uncertain")
            with self.assertRaisesRegex(RuntimeError, "manual reconciliation"):
                runner.run(publish=True, now=self.now)
        self.assertEqual(writer.call_count, 1)

    def test_recovers_written_post_after_ambiguous_response(self):
        first = runner.slot(0, runner.load_bank())
        history = [{"id": "confirmed-remotely", "text": first["text"],
                    "status": "scheduled", "channelId": "channel"}]
        with patch.object(runner, "validate_linkedin_channel"), \
             patch.object(runner, "remote_history", side_effect=[[], history]), \
             patch.object(runner, "create_scheduled_post", side_effect=[
                 TimeoutError("unknown"), "buffer-1", "buffer-2"
             ]) as writer:
            with self.assertRaises(TimeoutError), contextlib.redirect_stdout(io.StringIO()), \
                 contextlib.redirect_stderr(io.StringIO()):
                runner.run(publish=True, now=self.now)
            with contextlib.redirect_stdout(io.StringIO()):
                runner.run(publish=True, now=self.now)
        self.assertEqual(writer.call_count, 3)
        ledger = runner.load_state()["records"]
        self.assertEqual(len(ledger), 3)
        self.assertEqual(ledger[0]["status"], "reconciled_on_buffer")
        self.assertEqual(ledger[0]["buffer_post_id"], "confirmed-remotely")

    def test_publish_requires_explicit_second_publisher_disabled(self):
        os.environ["OTHER_LINKEDIN_AUTOMATION_DISABLED"] = "false"
        with self.assertRaisesRegex(RuntimeError, "Another LinkedIn publishing engine"):
            runner.run(publish=True, now=self.now)


if __name__ == "__main__":
    unittest.main()

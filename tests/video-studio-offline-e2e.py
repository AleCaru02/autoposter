#!/usr/bin/env python3
"""Real FFmpeg integration smoke test, no provider credentials."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
    folder=Path(tmp)
    plan={"version":1,"profileId":"test","title":"Smoke","format":"REEL_9_16","width":1080,"height":1920,"fps":30,
          "scenes":[{"id":"scene-1","startMs":0,"endMs":1000,"kind":"BROLL","narration":"Hello","overlay":"Hello"},
                    {"id":"scene-2","startMs":1000,"endMs":2000,"kind":"CTA","narration":"Contact","overlay":"Contact"}]}
    src=folder/"plan.json";src.write_text(json.dumps(plan),encoding="utf-8")
    out=folder/"reel.mp4"
    proc=subprocess.run([sys.executable,str(root/"scripts/video-studio-offline.py"),str(src),str(out)],
                        capture_output=True,text=True,timeout=180)
    assert proc.returncode==0,proc.stderr
    result=json.loads(proc.stdout.strip().splitlines()[-1])
    assert result["status"]=="READY" and result["costEur"]==0
    assert result["width"]==1080 and result["height"]==1920
    assert out.is_file() and out.stat().st_size>1000
    print("PASS offline MP4 E2E:",out.stat().st_size,"bytes",result["durationSeconds"],"seconds")
    bad=folder/"bad.json";bad.write_text(json.dumps({**plan,"scenes":[]}),encoding="utf-8")
    failed=subprocess.run([sys.executable,str(root/"scripts/video-studio-offline.py"),str(bad),str(folder/"bad.mp4")],
                          capture_output=True,text=True,timeout=30)
    assert failed.returncode!=0 and "INVALID_SCENES" in failed.stderr
    print("PASS fail-closed invalid storyboard")

#!/usr/bin/env python3
"""Offline regression: real motion clips and still images in the same Reel."""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RENDER = ROOT / "scripts" / "render-video-assets.py"

def run(*args):
    subprocess.run(args, check=True, capture_output=True, timeout=90)

def main():
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        print("SKIP: ffmpeg/ffprobe missing")
        return 0
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        clip = root / "scene-1.mp4"
        still = root / "scene-2.png"
        run("ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x568:rate=30", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(clip))
        run("ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x568", "-frames:v", "1", str(still))
        plan = {"format":"REEL_9_16","width":1080,"height":1920,"scenes":[
            {"id":"scene-1","startMs":0,"endMs":3000},
            {"id":"scene-2","startMs":3000,"endMs":5000}
        ]}
        (root/"plan.json").write_text(json.dumps(plan))
        (root/"manifest.json").write_text(json.dumps({"scene-1":str(clip),"scene-2":str(still)}))
        out = root/"result.mp4"
        run(sys.executable, str(RENDER), str(root/"plan.json"), str(root/"manifest.json"), str(out))
        result = subprocess.check_output(["ffprobe","-v","error","-show_entries","stream=width,height:format=duration","-of","json",str(out)],text=True)
        data=json.loads(result)
        assert data["streams"][0]["width"] == 1080
        assert data["streams"][0]["height"] == 1920
        assert abs(float(data["format"]["duration"])-5)<0.3
        print("PASS: MP4 motion + PNG still, 1080x1920, 5 seconds")
    return 0

if __name__=="__main__":
    sys.exit(main())

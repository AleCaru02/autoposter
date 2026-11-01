#!/usr/bin/env python3
"""One-command, no-network Reel renderer for local/offline testing.
Creates original scene cards from storyboard text with FFmpeg and renders an MP4.
Requires Python 3, ffmpeg, ffprobe. No credentials, charges or user data uploads.
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import importlib.util
_module_path = Path(__file__).with_name("render-video-assets.py")
_spec = importlib.util.spec_from_file_location("render_video_assets", _module_path)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
render = _module.render

def run(plan_path: Path, output_path: Path) -> dict:
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    if plan.get("format") != "REEL_9_16" or plan.get("width") != 1080 or plan.get("height") != 1920:\n        raise ValueError("INVALID_FORMAT")\n    scenes = plan.get("scenes", [])
    if not scenes or len(scenes) > 20:
        raise ValueError("INVALID_SCENES")
    if not all(isinstance(s.get("id"), str) and s["id"].replace("-","").isalnum() for s in scenes):
        raise ValueError("INVALID_SCENE_ID")
    previous = 0\n    for scene in scenes:\n        start, end = scene.get("startMs"), scene.get("endMs")\n        if not isinstance(start, int) or not isinstance(end, int) or start != previous or end <= start or end > 120000:\n            raise ValueError("INVALID_TIMELINE")\n        previous = end\n    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="autoposter-") as work:
        work = Path(work)
        manifest = {}
        for i, scene in enumerate(scenes):
            png = work / f"scene-{i:02d}.png"
            # Render a deterministic scene background without external services.
            subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y",
                "-f","lavfi","-i",f"color=c=0x{['13253e','24324c','18384a','26455a'][i%4]}:s=1080x1920:r=1",
                "-frames:v","1",str(png)],check=True,timeout=45)
            manifest[scene["id"]] = str(png)
        manifest_file = work / "manifest.json"
        manifest_file.write_text(json.dumps(manifest),encoding="utf-8")
        render(str(plan_path),str(manifest_file),str(output_path))
    result = subprocess.run(["ffprobe","-v","error","-select_streams","v:0",
        "-show_entries","stream=width,height","-show_entries","format=duration",
        "-of","json",str(output_path)],capture_output=True,text=True,check=True,timeout=30)
    probe = json.loads(result.stdout)
    stream = probe["streams"][0]
    duration = float(probe["format"]["duration"])
    expected = scenes[-1]["endMs"]/1000
    if stream["width"] != 1080 or stream["height"] != 1920 or abs(duration-expected)>0.15:
        output_path.unlink(missing_ok=True)
        raise RuntimeError("OUTPUT_VALIDATION_FAILED")
    return {"status":"READY","mode":"OFFLINE_TEST","output":str(output_path),
            "width":1080,"height":1920,"durationSeconds":duration,
            "aiGenerated":False,"voiceGenerated":False,"costEur":0}

if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("storyboard",type=Path)
    parser.add_argument("output",type=Path)
    args=parser.parse_args()
    try: print(json.dumps(run(args.storyboard,args.output)))
    except (ValueError,RuntimeError,subprocess.CalledProcessError,subprocess.TimeoutExpired,FileNotFoundError) as e:
        print(json.dumps({"status":"FAILED","error":str(e)}),file=sys.stderr)
        sys.exit(1)

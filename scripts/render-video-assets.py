#!/usr/bin/env python3
"""Offline MP4 assembly from approved, local PNG scene assets. No network or spending."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

def render(plan_file, manifest_file, output_file):
    plan = json.loads(Path(plan_file).read_text(encoding="utf-8"))
    manifest = json.loads(Path(manifest_file).read_text(encoding="utf-8"))
    if plan.get("format") != "REEL_9_16" or plan.get("width") != 1080 or plan.get("height") != 1920:
        raise ValueError("INVALID_FORMAT")
    scenes = plan.get("scenes", [])
    if not 1 <= len(scenes) <= 20:
        raise ValueError("INVALID_SCENES")
    if not isinstance(manifest, dict):
        raise ValueError("INVALID_MANIFEST")
    with tempfile.TemporaryDirectory() as temp:
        segments = []
        previous = 0
        for index, scene in enumerate(scenes):
            start, end = scene["startMs"], scene["endMs"]
            if not isinstance(start, int) or not isinstance(end, int) or start != previous or end <= start or end > 120000:
                raise ValueError("INVALID_TIMELINE")
            previous = end
            image = Path(manifest.get(scene["id"], ""))
            if not image.is_file() or image.suffix.lower() != ".png":
                raise ValueError("SCENE_IMAGE_REQUIRED:" + scene["id"])
            segment = Path(temp) / f"segment-{index:02d}.mp4"
            subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y",
                "-loop","1","-framerate","30","-i",str(image),"-t",str((end-start)/1000),
                "-vf","scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p",
                "-r","30","-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p",str(segment)],
                check=True,timeout=180)
            segments.append(segment)
        concat = Path(temp) / "segments.txt"
        concat.write_text("".join("file '"+str(p)+"'\n" for p in segments),encoding="utf-8")
        subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-f","concat","-safe","0",
            "-i",str(concat),"-c","copy","-movflags","+faststart",str(output_file)],check=True,timeout=180)
    return str(output_file)

if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("Usage: render-video-assets.py storyboard.json scene-images.json output.mp4")
    try:
        print(render(*sys.argv[1:]))
    except (ValueError,subprocess.CalledProcessError,subprocess.TimeoutExpired) as error:
        sys.exit(str(error))

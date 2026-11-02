#!/usr/bin/env python3
"""Offline MP4 assembly from approved local PNG or real MP4 motion clips. No network or spending."""
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
    audio_value = manifest.get("__audio__")
    audio = Path(audio_value) if isinstance(audio_value, str) and audio_value else None
    if audio is not None and (not audio.is_file() or audio.suffix.lower() not in (".wav", ".mp3", ".m4a")):
        raise ValueError("INVALID_AUDIO_ASSET")
    with tempfile.TemporaryDirectory() as temp:
        segments = []
        previous = 0
        for index, scene in enumerate(scenes):
            start, end = scene["startMs"], scene["endMs"]
            if not isinstance(start, int) or not isinstance(end, int) or start != previous or end <= start or end > 120000:
                raise ValueError("INVALID_TIMELINE")
            previous = end
            asset_value = manifest.get(scene["id"])
            if not isinstance(asset_value, str) or not asset_value:
                raise ValueError("SCENE_ASSET_REQUIRED:" + scene["id"])
            image = Path(asset_value)
            if not image.is_file() or image.suffix.lower() not in (".png", ".mp4"):
                raise ValueError("SCENE_ASSET_REQUIRED:" + scene["id"])
            segment = Path(temp) / f"segment-{index:02d}.mp4"
            source_args = ["-loop","1","-framerate","30","-i",str(image)] if image.suffix.lower() == ".png" else ["-i",str(image)]
            subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y",*source_args,
                "-t",str((end-start)/1000),
                "-vf","fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p",
                "-an","-r","30","-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p",str(segment)],
                check=True,timeout=180)
            segments.append(segment)
        concat = Path(temp) / "segments.txt"
        concat.write_text("".join("file '"+str(p)+"'\n" for p in segments),encoding="utf-8")
        command = ["ffmpeg","-hide_banner","-loglevel","error","-y","-f","concat","-safe","0","-i",str(concat)]
        if audio is not None:
            command += ["-i",str(audio),"-map","0:v:0","-map","1:a:0","-c:v","copy","-c:a","aac","-b:a","160k","-af","apad","-t",str(previous/1000)]
        else:
            command += ["-c","copy"]
        command += ["-movflags","+faststart",str(output_file)]
        subprocess.run(command,check=True,timeout=180)
    return str(output_file)

if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("Usage: render-video-assets.py storyboard.json scene-images.json output.mp4")
    try:
        print(render(*sys.argv[1:]))
    except (ValueError,subprocess.CalledProcessError,subprocess.TimeoutExpired) as error:
        sys.exit(str(error))

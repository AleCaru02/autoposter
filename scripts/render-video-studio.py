#!/usr/bin/env python3
"""Render a validated Video Studio storyboard as a local MP4 with FFmpeg.
No external API calls, avatar synthesis, asset downloads, or publishing.
Usage: python3 scripts/render-video-studio.py storyboard.json output.mp4
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

def escape_drawtext(text):
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace("%", "\\%").replace(",", "\\,").replace("[", "\\[").replace("]", "\\]")

def render(source, target):
    if not shutil.which("ffmpeg"):
        raise RuntimeError("FFMPEG_NOT_INSTALLED")
    plan=json.loads(Path(source).read_text(encoding="utf-8"))
    if plan.get("format")!="REEL_9_16" or plan.get("width")!=1080 or plan.get("height")!=1920 or plan.get("fps")!=30:
        raise ValueError("INVALID_VIDEO_FORMAT")
    scenes=plan.get("scenes")
    if not isinstance(scenes,list) or not scenes or len(scenes)>20:
        raise ValueError("INVALID_SCENES")
    previous=0
    for scene in scenes:
        start,end=scene["startMs"],scene["endMs"]
        if not isinstance(start,int) or not isinstance(end,int) or start!=previous or end<=start or end>120000:
            raise ValueError("INVALID_TIMELINE")
        previous=end
    filters=[]
    for scene in scenes:
        overlay=escape_drawtext(str(scene.get("overlay",""))[:110])
        start=scene["startMs"]/1000
        end=scene["endMs"]/1000
        filters.append(f"drawtext=text='{overlay}':fontcolor=white:fontsize=55:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t\\,{start:.3f}\\,{end:.3f})'")
    cmd=["ffmpeg","-hide_banner","-loglevel","error","-y","-f","lavfi","-i",f"color=c=0x131c2b:s=1080x1920:r=30:d={previous/1000:.3f}","-vf",",".join(filters),"-c:v","libx264","-preset","ultrafast","-pix_fmt","yuv420p","-movflags","+faststart",str(target)]
    subprocess.run(cmd,check=True,timeout=180)
    return target

if __name__=="__main__":
    if len(sys.argv)!=3:
        sys.exit("Usage: render-video-studio.py storyboard.json output.mp4")
    try:
        print(render(sys.argv[1],sys.argv[2]))
    except (ValueError,RuntimeError,subprocess.CalledProcessError,subprocess.TimeoutExpired) as error:
        sys.exit(str(error))

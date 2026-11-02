#!/usr/bin/env python3
"""Private polling renderer. Requires Neon + R2; no public HTTP endpoint or paid AI calls.
Start only after staging migration, R2 bucket and credentials are configured.
"""
import argparse
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

import boto3
import psycopg
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parents[2]
RENDERER = ROOT / "scripts" / "render-video-assets.py"
DATABASE_URL = os.environ["DATABASE_URL"]
BUCKET = os.environ["VIDEO_R2_BUCKET"]
PROFILE_PREFIX = "video-studio/"
INTERVAL = max(5, int(os.getenv("VIDEO_POLL_SECONDS", "20")))

def storage():
    return boto3.client("s3", endpoint_url=os.environ["VIDEO_R2_ENDPOINT"],
                        aws_access_key_id=os.environ["VIDEO_R2_ACCESS_KEY_ID"],
                        aws_secret_access_key=os.environ["VIDEO_R2_SECRET_ACCESS_KEY"],
                        region_name="auto")

def claim(conn, client):
    with conn.transaction():
        rows = conn.execute("""
            select id::text,profile_id::text,plan,reserved_eur
            from public.video_studio_jobs
            where state='QUEUED' order by created_at
            for update skip locked limit 20
        """).fetchall()
        for row in rows:
            job_id,profile_id,plan,_=row
            scenes=plan.get("scenes",[])
            if not scenes or len(scenes)>20:
                continue
            ready=True
            for scene in scenes:
                scene_id=scene.get("id","")
                if not isinstance(scene_id,str) or not scene_id.startswith("scene-") or not scene_id[6:].isdigit():
                    ready=False
                    break
                found=False
                for ext in ("mp4","png"):
                    try:
                        client.head_object(Bucket=BUCKET,Key=f"{PROFILE_PREFIX}{profile_id}/{job_id}/{scene_id}.{ext}")
                        found=True
                        break
                    except ClientError as exc:
                        if exc.response.get("Error",{}).get("Code") not in ("404","NoSuchKey","NotFound"):
                            raise
                if not found:
                    ready=False
                    break
            if ready:
                conn.execute("update public.video_studio_jobs set state='RENDERING',updated_at=now() where id=%s::uuid",(job_id,))
                return row
        return None

def finish(conn, job, state, error=None, output=None):
    job_id, profile_id, _, reserved = job
    with conn.transaction():
        row = conn.execute("select state from public.video_studio_jobs where id=%s::uuid for update",(job_id,)).fetchone()
        if not row or row[0]!="RENDERING":
            return
        # This renderer has no metered AI calls. Release the full reservation.
        conn.execute("""update public.video_studio_budget set reserved_eur=reserved_eur-%s
                        where profile_id=%s::uuid and month_utc=(
                        select month_utc from public.video_studio_jobs where id=%s::uuid)""",
                     (reserved,profile_id,job_id))
        conn.execute("""update public.video_studio_jobs set state=%s,error_code=%s,output_key=%s,
                        reserved_eur=0,actual_eur=0,updated_at=now() where id=%s::uuid""",
                     (state,error,output,job_id))

def render_job(conn, client, job):
    job_id, profile_id, plan, _ = job
    prefix=f"{PROFILE_PREFIX}{profile_id}/{job_id}/"
    scenes=plan.get("scenes",[])
    if not 1<=len(scenes)<=20 or plan.get("format")!="REEL_9_16":
        raise ValueError("INVALID_VIDEO_PLAN")
    with tempfile.TemporaryDirectory(prefix="autoposter-render-") as folder:
        tmp=Path(folder)
        manifest={}
        for scene in scenes:
            scene_id=scene.get("id","")
            if not isinstance(scene_id,str) or not scene_id.startswith("scene-") or not scene_id[6:].isdigit():
                raise ValueError("INVALID_SCENE_ID")
            file=None
            for ext in ("mp4","png"):
                candidate=tmp/(scene_id+"."+ext)
                try:
                    client.download_file(BUCKET,prefix+scene_id+"."+ext,str(candidate))
                    file=candidate
                    break
                except ClientError as exc:
                    if exc.response.get("Error",{}).get("Code") not in ("404","NoSuchKey","NotFound"):
                        raise
            if file is None:
                raise ValueError("MISSING_SCENE_ASSET")
            limit=120*1024*1024 if file.suffix==".mp4" else 8*1024*1024
            if file.stat().st_size>limit:
                raise ValueError("SCENE_ASSET_TOO_LARGE")
            manifest[scene_id]=str(file)
        # Audio is a licensed, pre-generated asset. This worker never calls paid TTS APIs.
        if plan.get("requiresNarration") is True:
            audio_key=prefix+"narration.mp3"
            audio_file=tmp/"narration.mp3"
            try:
                client.download_file(BUCKET,audio_key,str(audio_file))
            except ClientError as exc:
                if exc.response.get("Error",{}).get("Code") in ("404","NoSuchKey","NotFound"):
                    raise ValueError("NARRATION_REQUIRED") from exc
                raise
            if not 0<audio_file.stat().st_size<=20*1024*1024:
                raise ValueError("INVALID_NARRATION_SIZE")
            manifest["__audio__"]=str(audio_file)
        plan_file=tmp/"plan.json"
        plan_file.write_text(json.dumps(plan),encoding="utf-8")
        manifest_file=tmp/"manifest.json"
        manifest_file.write_text(json.dumps(manifest),encoding="utf-8")
        output=tmp/"output.mp4"
        subprocess.run(["python3",str(RENDERER),str(plan_file),str(manifest_file),str(output)],
                       check=True,timeout=900,capture_output=True)
        probe=subprocess.run(["ffprobe","-v","error","-show_entries","stream=codec_type,width,height:format=duration",
                              "-select_streams","v:0","-of","json",str(output)],
                             check=True,timeout=30,capture_output=True,text=True)
        inspection=json.loads(probe.stdout)
        streams=inspection.get("streams",[])
        video=next((stream for stream in streams if stream.get("codec_type")=="video"),None)
        if not video or video.get("width")!=1080 or video.get("height")!=1920:
            raise ValueError("INVALID_OUTPUT")
        if plan.get("requiresNarration") is True and not any(stream.get("codec_type")=="audio" for stream in streams):
            raise ValueError("MISSING_OUTPUT_AUDIO")
        duration=float(inspection.get("format",{}).get("duration",0))
        expected=scenes[-1].get("endMs",0)/1000
        if not expected or abs(duration-expected)>1.0:
            raise ValueError("INVALID_OUTPUT_DURATION")
        key=prefix+"output.mp4"
        client.upload_file(str(output),BUCKET,key,ExtraArgs={"ContentType":"video/mp4"})
        finish(conn,job,"READY",output=key)

def main():
    parser = argparse.ArgumentParser(description="Autoposter video renderer")
    parser.add_argument("--once", action="store_true", help="Process at most one ready job, then exit")
    args = parser.parse_args()
    client=storage()
    while True:
        try:
            with psycopg.connect(DATABASE_URL,autocommit=True) as conn:
                job=claim(conn,client)
                if job:
                    try:
                        render_job(conn,client,job)
                        print(json.dumps({"job":job[0],"state":"READY"}),flush=True)
                    except Exception as exc:
                        print(json.dumps({"job":job[0],"state":"FAILED","type":type(exc).__name__}),flush=True)
                        finish(conn,job,"FAILED",error=type(exc).__name__[:80])
        except Exception as exc:
            print(json.dumps({"state":"WORKER_ERROR","type":type(exc).__name__}),flush=True)
        if args.once:
            return
        time.sleep(INTERVAL)

if __name__=="__main__":
    main()

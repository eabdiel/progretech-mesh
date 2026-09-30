#!/usr/bin/env python3
import argparse, json, subprocess, time, urllib.request, urllib.error, socket, os, signal
from pathlib import Path
from PIL import Image, ImageStat

COMFY=Path.home()/".local/share/rend/runtimes/comfyui-rocm/ComfyUI"
PYTHON=Path.home()/".local/share/rend/runtimes/comfyui-rocm/bin/python"
MODEL="animagine-xl-3.1.safetensors"

def port():
    for p in range(8301,8350):
        s=socket.socket()
        try:
            s.bind(("127.0.0.1",p)); s.close(); return p
        except OSError:
            s.close()
    raise RuntimeError("no_free_port")

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--prompt",required=True)
    ap.add_argument("--output-dir",required=True)
    a=ap.parse_args()
    out=Path(a.output_dir); out.mkdir(parents=True,exist_ok=True)
    prt=port()
    log=(out/"comfyui.log").open("w")
    proc=subprocess.Popen([str(PYTHON),str(COMFY/"main.py"),"--listen","127.0.0.1","--port",str(prt),"--disable-auto-launch","--fp32-vae"],
                          cwd=COMFY,stdout=log,stderr=subprocess.STDOUT,text=True)
    try:
        for _ in range(90):
            if proc.poll() is not None: raise RuntimeError("comfyui_exited")
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{prt}/object_info",timeout=2).read(); break
            except Exception: time.sleep(1)
        else: raise TimeoutError("comfyui_not_ready")

        prefix=f"PT-2026-049B/runtime-image-{int(time.time())}"
        neg="lowres, blurry, distorted, text, watermark, duplicate, malformed"
        graph={
          "1":{"class_type":"CheckpointLoaderSimple","inputs":{"ckpt_name":MODEL}},
          "2":{"class_type":"CLIPTextEncode","inputs":{"text":a.prompt,"clip":["1",1]}},
          "3":{"class_type":"CLIPTextEncode","inputs":{"text":neg,"clip":["1",1]}},
          "4":{"class_type":"EmptyLatentImage","inputs":{"width":1024,"height":1024,"batch_size":1}},
          "5":{"class_type":"KSampler","inputs":{"model":["1",0],"seed":49101,"steps":16,"cfg":7.0,"sampler_name":"euler_ancestral","scheduler":"normal","positive":["2",0],"negative":["3",0],"latent_image":["4",0],"denoise":1.0}},
          "6":{"class_type":"VAEDecode","inputs":{"samples":["5",0],"vae":["1",2]}},
          "7":{"class_type":"SaveImage","inputs":{"images":["6",0],"filename_prefix":prefix}},
        }
        body=json.dumps({"prompt":graph,"client_id":"pt049b-runtime"}).encode()
        req=urllib.request.Request(f"http://127.0.0.1:{prt}/prompt",data=body,headers={"Content-Type":"application/json"})
        resp=json.load(urllib.request.urlopen(req,timeout=30))
        pid=resp["prompt_id"]
        deadline=time.time()+900
        while time.time()<deadline:
            try:
                hist=json.load(urllib.request.urlopen(f"http://127.0.0.1:{prt}/history/{pid}",timeout=10))
                st=hist.get(pid,{}).get("status",{})
                if st.get("completed") is True: break
                if st.get("status_str")=="error": raise RuntimeError("generation_error")
            except urllib.error.URLError:
                pass
            time.sleep(2)
        else: raise TimeoutError("image_timeout")

        folder=COMFY/"output"/"PT-2026-049B"
        files=sorted(folder.glob(Path(prefix).name+"*"),key=lambda p:p.stat().st_mtime,reverse=True)
        if not files: raise RuntimeError("image_artifact_missing")
        art=files[0]
        im=Image.open(art)
        stat=ImageStat.Stat(im.convert("RGB"))
        if im.size!=(1024,1024) or max(stat.var)<=1.0: raise RuntimeError("image_validation_failed")
        result={"artifact":str(art),"width":im.width,"height":im.height,"format":im.format}
        (out/"result.json").write_text(json.dumps(result,indent=2))
        print(json.dumps(result))
    finally:
        proc.terminate()
        try: proc.wait(timeout=10)
        except subprocess.TimeoutExpired: proc.kill()
        log.close()

if __name__=="__main__": main()

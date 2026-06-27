"""
Persistent OCR worker (runs the baidu/Unlimited-OCR model).

Loads the model ONCE and OCRs many images over its lifetime, speaking a
JSON-lines protocol over stdin/stdout so a parent process (the TS ocrEngine)
can drive it without paying the model-load cost per image.

Protocol:
  - On start, prints exactly one line to stdout: {"ready": true}
  - For each stdin line {"id": "...", "image": "/abs/path.png"} it OCRs the
    single image and prints one line:
        {"id": "...", "ok": true, "text": "<markdown>"}
    or on failure:
        {"id": "...", "ok": false, "error": "<message>"}
  - EOF on stdin -> exit 0.

stdout is a clean JSON-lines channel: every diagnostic / model print is sent
to stderr instead. Inference reuses run_ocr.py's load_model() and the exact
single-image gundam call from infer_single() (do not reimplement inference).
"""

import argparse
import contextlib
import json
import os
import shutil
import sys
import tempfile

from run_ocr import MODEL_NAME, cuda_redirect, load_model


def _emit(obj):
    """Write one JSON object as a line to stdout and flush."""
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def ocr_one(model, tokenizer, device, image_file):
    """OCR a single image and return its result.md text.

    Mirrors run_ocr.infer_single's gundam single-image call exactly, but writes
    into a throwaway tempdir and returns the produced markdown instead of
    leaving files behind.
    """
    work_dir = tempfile.mkdtemp(prefix="ocr_server_")
    try:
        # Keep stdout clean: the model's save_results path prints progress.
        with contextlib.redirect_stdout(sys.stderr):
            with cuda_redirect(device):
                model.infer(
                    tokenizer,
                    prompt="<image>document parsing.",
                    image_file=image_file,
                    output_path=work_dir,
                    base_size=1024, image_size=640, crop_mode=True,
                    max_length=32768,
                    no_repeat_ngram_size=35, ngram_window=128,
                    save_results=True,
                )
        result_md = os.path.join(work_dir, "result.md")
        if not os.path.exists(result_md):
            raise RuntimeError(f"no result.md produced for {image_file}")
        with open(result_md, encoding="utf-8") as f:
            return f.read()
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description="Persistent Unlimited-OCR worker")
    parser.add_argument("--model_dir", default=MODEL_NAME, help="Local path or HuggingFace model ID")
    args = parser.parse_args()

    # All load-time diagnostics go to stderr so stdout stays a clean channel.
    with contextlib.redirect_stdout(sys.stderr):
        model, tokenizer, device = load_model(args.model_dir)

    _emit({"ready": True})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            _emit({"id": None, "ok": False, "error": f"invalid JSON: {e}"})
            continue

        req_id = req.get("id")
        image = req.get("image")
        if not image:
            _emit({"id": req_id, "ok": False, "error": "missing 'image' field"})
            continue

        try:
            text = ocr_one(model, tokenizer, device, image)
            _emit({"id": req_id, "ok": True, "text": text})
        except Exception as e:  # noqa: BLE001 - report any failure back over the channel
            _emit({"id": req_id, "ok": False, "error": str(e)})


if __name__ == "__main__":
    main()

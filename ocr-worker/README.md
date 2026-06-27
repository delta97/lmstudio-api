# OCR worker

The local OCR engine behind the [content-invariance check](../README.md#ocr-content-invariance-check)
(`expectOcrInvariant` / the `ocr-diff` CLI). It runs the
[`baidu/Unlimited-OCR`](https://huggingface.co/baidu/Unlimited-OCR) model
in-process on Apple Silicon (MPS) or CPU — no CUDA, no LM Studio/SGLang server.

- `ocr_server.py` — persistent JSON-lines worker. Loads the model once, then
  OCRs one image per stdin line. Driven as a subprocess by
  [`src/ocr/ocrEngine.ts`](../src/ocr/ocrEngine.ts).
- `run_ocr.py` — model loading + the single-image inference call the worker
  reuses (also usable standalone as a CLI for images/PDFs).
- `requirements.txt` — pinned Python dependencies (Python 3.10).

## Setup

```bash
cd ocr-worker
python3.10 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

The TS engine looks for `ocr-worker/.venv/bin/python` by default. Override with
`OCR_WORKER_DIR` / `OCR_WORKER_PYTHON` to point at a different location or
interpreter. Model weights download from HuggingFace on first run and are cached
afterward.

## Quick check

```bash
echo '{"id":"1","image":"/abs/path/to/image.png"}' | .venv/bin/python ocr_server.py
# -> {"ready": true}
# -> {"id": "1", "ok": true, "text": "..."}
```

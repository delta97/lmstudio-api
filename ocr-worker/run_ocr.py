"""
Local OCR inference using Unlimited-OCR via HuggingFace Transformers.
Runs on Apple Silicon (MPS) or CPU — no CUDA required.

Usage:
  Single image:
    python run_ocr.py --image your_image.jpg --output ./outputs

  PDF:
    python run_ocr.py --pdf your_doc.pdf --output ./outputs

  Multi-page (list of images):
    python run_ocr.py --images page1.png page2.png --output ./outputs
"""

import argparse
import contextlib
import os
import tempfile

import torch
from transformers import AutoModel, AutoTokenizer

MODEL_NAME = "baidu/Unlimited-OCR"


def get_device():
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


@contextlib.contextmanager
def cuda_redirect(device):
    """Redirect tensor.cuda() and torch.autocast('cuda') to the given device.

    The model's infer/infer_multi methods are hardcoded for CUDA. This context
    manager transparently reroutes those calls so they work on MPS or CPU.
    """
    if device == "cuda":
        yield
        return

    _orig_tensor_cuda = torch.Tensor.cuda
    _orig_autocast = torch.autocast

    def _tensor_to_device(self, device_id=None, **kwargs):
        return self.to(device)

    def _autocast_redirect(device_type, *args, **kwargs):
        if device_type == "cuda":
            # Model is already in bfloat16; skip autocast on non-CUDA backends
            # to avoid MPS numerical instability in mixed-precision paths.
            return contextlib.nullcontext()
        return _orig_autocast(device_type, *args, **kwargs)

    torch.Tensor.cuda = _tensor_to_device
    torch.autocast = _autocast_redirect
    try:
        yield
    finally:
        torch.Tensor.cuda = _orig_tensor_cuda
        torch.autocast = _orig_autocast


def load_model(model_dir=MODEL_NAME):
    device = get_device()
    print(f"Using device: {device}")
    tokenizer = AutoTokenizer.from_pretrained(model_dir, trust_remote_code=True)
    model = AutoModel.from_pretrained(
        model_dir,
        trust_remote_code=True,
        use_safetensors=True,
        torch_dtype=torch.bfloat16,
    )
    model = model.eval().to(device)
    return model, tokenizer, device


def pdf_to_images(pdf_path, dpi=300):
    import fitz
    doc = fitz.open(pdf_path)
    tmp_dir = tempfile.mkdtemp(prefix="pdf_ocr_")
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    paths = []
    n = doc.page_count
    for i in range(n):
        page = doc[i]
        out = os.path.join(tmp_dir, f"page_{i+1:04d}.png")
        page.get_pixmap(matrix=mat).save(out)
        paths.append(out)
    doc.close()
    return paths


def infer_pdf_pages(model, tokenizer, device, pdf_path, output_dir, dpi=300):
    """Process each PDF page independently with single-page inference."""
    pages = pdf_to_images(pdf_path, dpi=dpi)
    os.makedirs(output_dir, exist_ok=True)
    prefix = os.path.splitext(os.path.basename(pdf_path))[0]
    all_text = []
    for i, page_img in enumerate(pages):
        page_out = os.path.join(output_dir, f"page_{i+1:04d}")
        os.makedirs(page_out, exist_ok=True)
        print(f"[{i+1}/{len(pages)}] Processing {page_img}")
        with cuda_redirect(device):
            model.infer(
                tokenizer,
                prompt="<image>document parsing.",
                image_file=page_img,
                output_path=page_out,
                base_size=1024, image_size=640, crop_mode=True,
                max_length=32768,
                no_repeat_ngram_size=35, ngram_window=128,
                save_results=True,
            )
        page_md = os.path.join(page_out, "result.md")
        if os.path.exists(page_md):
            with open(page_md, encoding="utf-8") as f:
                all_text.append(f"<!-- Page {i+1} -->\n{f.read()}")
    combined = os.path.join(output_dir, f"{prefix}_combined.md")
    with open(combined, "w", encoding="utf-8") as f:
        f.write("\n\n---\n\n".join(all_text))
    print(f"\nAll pages saved to: {output_dir}")
    print(f"Combined output: {combined}")


def infer_single(model, tokenizer, device, image_file, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    print(f"Processing: {image_file}")
    with cuda_redirect(device):
        model.infer(
            tokenizer,
            prompt="<image>document parsing.",
            image_file=image_file,
            output_path=output_dir,
            base_size=1024, image_size=640, crop_mode=True,
            max_length=32768,
            no_repeat_ngram_size=35, ngram_window=128,
            save_results=True,
        )
    print(f"Output saved to: {output_dir}")


def infer_multi(model, tokenizer, device, image_files, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    print(f"Processing {len(image_files)} pages...")
    with cuda_redirect(device):
        model.infer_multi(
            tokenizer,
            prompt="<image>Multi page parsing.",
            image_files=image_files,
            output_path=output_dir,
            image_size=1024,
            max_length=32768,
            no_repeat_ngram_size=35, ngram_window=1024,
            save_results=True,
        )
    print(f"Output saved to: {output_dir}")


def main():
    parser = argparse.ArgumentParser(description="Unlimited-OCR local inference (macOS/MPS)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--image", help="Single image file")
    group.add_argument("--images", nargs="+", help="Multiple image files (multi-page mode)")
    group.add_argument("--pdf", help="PDF — process as one long sequence (multi-page mode)")
    group.add_argument("--pdf-pages", dest="pdf_pages", help="PDF — process each page independently (recommended on MPS/CPU)")
    parser.add_argument("--output", default="./outputs", help="Output directory")
    parser.add_argument("--model_dir", default=MODEL_NAME, help="Local path or HuggingFace model ID")
    parser.add_argument("--dpi", type=int, default=300, help="DPI for PDF conversion")
    args = parser.parse_args()

    model, tokenizer, device = load_model(args.model_dir)

    if args.image:
        infer_single(model, tokenizer, device, args.image, args.output)
    elif args.pdf_pages:
        infer_pdf_pages(model, tokenizer, device, args.pdf_pages, args.output, dpi=args.dpi)
    elif args.pdf:
        pages = pdf_to_images(args.pdf, dpi=args.dpi)
        infer_multi(model, tokenizer, device, pages, args.output)
    else:
        infer_multi(model, tokenizer, device, args.images, args.output)


if __name__ == "__main__":
    main()

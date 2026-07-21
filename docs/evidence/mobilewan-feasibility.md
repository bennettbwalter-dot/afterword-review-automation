# MobileWAN feasibility gate

- **Decision:** Block paid MobileWAN generation and do not integrate a substitute provider. Retain MobileWAN as a paid feature behind a disabled release gate until the benchmark and legal gates below pass.
- **Date:** 2026-07-21
- **Immutable revision (source):** `71149a052364f7346c40c8f2d88311f457f1a46b` (`qualcomm-ai-research/mobilewan`).
- **Immutable revision (MobileWAN weights):** `3f5d75a27582161295dfb0b4e3d39cc7bef04fc4` (`Qualcomm-AI-Research/mobilewan`).
- **Immutable revision (Wan2.2 base):** `b8fff7315c768468a5333511427288870b2e9635` (`Wan-AI/Wan2.2-TI2V-5B-Diffusers`).
- **Owner:** Product owner, with the managed-GPU operator responsible for the run and Legal responsible for commercial clearance.
- **State:** blocked

No managed GPU account, quota, model snapshot, container registry, IAM boundary, observability plan, or approved budget has been supplied.

## Verified feasibility boundary

The pinned MobileWAN CLI is text-to-video only: one text prompt produces one MP4. Its fixed configuration is 480x832, 81 frames, CFG 1.0, with defaults of 16 FPS and three denoising steps. It does not expose image conditioning. Customer photos and logos can therefore be overlays, end cards, thumbnails, or deterministic rendition inputs only; the product must not advertise MobileWAN image-to-video.

The pinned source requires Python 3.10.12 or newer and lists Accelerate, Diffusers, Einops, ImageIO with FFmpeg, Safetensors, PyTorch, and Transformers. Qualcomm's Dockerfile uses CUDA 12.8.1, PyTorch 2.7.1+cu128, FFmpeg, and NVIDIA Container Runtime. These are source facts, not a successful build or compatibility result.

The first benchmark target is an NVIDIA A100 80 GB. Lower VRAM is not promised until it is measured. The public MobileWAN snapshot contains five transformer safetensor shards totalling 9,926,482,568 bytes; the pinned Wan2.2 base snapshot is about 34.18 GB decimal. Qualcomm describes MobileWAN as BF16, about 5B DiT, research-oriented, and dependent on the original Wan decoder because its optimized decoder is not released.

Official sources: [pinned source](https://github.com/qualcomm-ai-research/mobilewan/tree/71149a052364f7346c40c8f2d88311f457f1a46b), [pinned package requirements](https://github.com/qualcomm-ai-research/mobilewan/blob/71149a052364f7346c40c8f2d88311f457f1a46b/pyproject.toml), [pinned Dockerfile](https://github.com/qualcomm-ai-research/mobilewan/blob/71149a052364f7346c40c8f2d88311f457f1a46b/docker/Dockerfile), [MobileWAN snapshot](https://huggingface.co/Qualcomm-AI-Research/mobilewan/tree/3f5d75a27582161295dfb0b4e3d39cc7bef04fc4), and [Wan2.2 snapshot](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B-Diffusers/tree/b8fff7315c768468a5333511427288870b2e9635).

## Evidence still needed

Run `scripts/mobilewan/benchmark.ps1` only on the owner-supplied managed NVIDIA A100 80 GB GPU against the exact local snapshots. Before any sample command, it requires an owner-supplied offline provenance JSON file with the two exact revisions and SHA-256 entries for snapshot files; directory names and marker files alone are not proof. The run must use at least ten representative promotional prompts with fixed integer seeds and record cold/warm latency, peak VRAM, technically-valid-output rate, output checksums, retries/concurrency, and cost per technically valid clip. The wrapper does not download weights or select a provider. A lower-VRAM or non-A100 device cannot emit a qualifying artifact.

Required owner inputs are the managed GPU project/region/SKU/quota, driver compatibility, encrypted disk and registry, IAM and secret-manager boundary, egress policy, autoscaling/concurrency policy, observability, budget, local complete model snapshots plus hashes, and the ten-prompt manifest. The future operator also needs an approved container digest and dependency lock.

## Release consequence

The paid generation capability remains disabled. Manual upload and all ready non-GPU paths may proceed. No p95 successful-clip cost exists, so the minimum video-inclusive and five-unit-pack prices cannot be calculated (`p95 successful clip cost x included units x 3`) and no live Stripe Price may be created.

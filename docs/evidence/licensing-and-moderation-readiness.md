# Licensing and moderation readiness gate

- **Decision:** Block paid MobileWAN output and paid video pricing until Legal approves the exact combined terms and an owner-selected real moderation service is proven fail-closed. No pass-through moderation adapter is acceptable.
- **Date:** 2026-07-21
- **Immutable revision (MobileWAN source):** `71149a052364f7346c40c8f2d88311f457f1a46b`.
- **Immutable revision (MobileWAN weights):** `3f5d75a27582161295dfb0b4e3d39cc7bef04fc4`.
- **Immutable revision (Wan2.2 base):** `b8fff7315c768468a5333511427288870b2e9635`.
- **Owner:** Legal owner for clearance; product owner for moderation, disclosure, and pricing decisions.
- **State: blocked.** There is no legal clearance, moderation vendor account/configuration, policy threshold, escalation process, evidence-retention decision, licensed-track inventory, or approved price amount.

## Verified facts and decisions pending

MobileWAN source code is BSD 3-Clause Clear, while the model card links Qualcomm's Responsible AI License. The pinned Wan2.2 base is Apache-2.0-labelled. These official labels do not clear paid multi-tenant use; Legal must approve the combined Qualcomm terms, weights, and SaaS use before release.

Official sources: [MobileWAN licence](https://github.com/qualcomm-ai-research/mobilewan/blob/71149a052364f7346c40c8f2d88311f457f1a46b/LICENSE.txt), [MobileWAN model card](https://huggingface.co/Qualcomm-AI-Research/mobilewan/blob/3f5d75a27582161295dfb0b4e3d39cc7bef04fc4/README.md), [Qualcomm Responsible AI License](https://www.qualcomm.com/site/responsible-ai-license), and [pinned Wan2.2 snapshot](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B-Diffusers/tree/b8fff7315c768468a5333511427288870b2e9635).

The decision register remains blocked for MobileWAN code and weights, Wan2.2, the PyTorch/CUDA image, FFmpeg/codecs, ClamAV, the selected moderation service, every licensed track, and customer-output ownership/rights. It also requires approved rules for content/IP/likeness, AI disclosure, privacy/DPA, export/sanctions, retention, and attribution.

## Moderation proof still needed

Select a real prompt/image/video moderation service and record its contract, regions, data retention, thresholds, categories, escalation route, and protected credential location. Demonstrate that prompt, input-media, and output-media checks reject or hold disallowed work, and that service outage fails closed. Record operator review and audit-retention decisions without storing customer media or credentials here.

## Pricing consequence

No p95 successful-clip cost has been measured. After the managed-GPU benchmark passes, calculate each minimum price as `p95 successful clip cost x included units x 3`, including video-inclusive units and the five-unit pack. The owner must approve rounded GBP/USD amounts before live Stripe Prices are created; existing review/SMS prices must not be repurposed.

## Release consequence

Paid generation, paid video packs, and any generated-media release remain disabled. Silent/manual paths may proceed only where their own rights and platform gates pass.

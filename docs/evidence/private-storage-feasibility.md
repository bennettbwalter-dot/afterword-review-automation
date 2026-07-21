# Private Storage feasibility gate

- **Decision:** Block media-storage release until private Supabase Storage is proven with the current opaque session. Do not route asset bytes through the API or treat a Storage path as authorization.
- **Date:** 2026-07-21
- **Immutable revision:** Not applicable: the required private Storage project, bucket configuration, and resumable-upload policy have not been supplied. This document is a dated infrastructure gate rather than a model release.
- **Owner:** Product owner and Supabase/Storage operator.
- **State: blocked.** No private Storage project, bucket, region, encryption setting, lifecycle policy, service-role boundary, or staging credentials are available.

## Required proof

Using the existing opaque same-site session, prove a direct private upload, resume it after an interruption, reject an expired token, deny a cross-path attempt, issue a short-lived read, and delete the asset. Record exact request/response evidence without retaining tokens or signed URLs in this repository.

Signed TUS is not verified. The operator must record whether signed TUS works for the selected Supabase project. If it does not, select path-scoped Supabase S3 multipart, record that decision and expiry policy, and repeat the same six proof cases. This is not permission to substitute a public bucket or a generic provider.

## Evidence still needed

The owner must supply the private project and separate staging/production buckets, region and encryption decisions, resumable authorization method, retention/lifecycle and deletion/export process, service-role access boundary, CORS policy, and a controlled test tenant. The run must document interruption behavior, token lifetime, path isolation, read expiry, deletion result, and residual-object check.

## Release consequence

Private media upload, generated output storage, and any feature that signs media URLs remain unavailable. Product work may only expose no-media or manual paths already proven independently; no production Storage integration is authorized by this record.

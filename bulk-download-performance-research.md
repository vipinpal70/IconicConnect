# Bulk Download — Hardware Usage & Bottleneck Analysis

Scope: the streaming ZIP bulk download (`src/lib/bulk-download/*`, routes under `/api/client/cases/bulk-download` and `/api/cases/bulk/download`).

**Evidence levels used below:** 🟢 measured locally · 🟡 reasoned from code/config · ⚪ not measured (needs production test).
Benchmarks ran on a dev machine (16 cores, 24 GB) with synthetic sources, **not** production hardware and **not** real R2.

---

## 1. Data path

```
R2 bucket ──TLS──▶ Node (Next, PM2, 2 GB cap) ──▶ nginx ──▶ Cloudflare ──▶ user
                     │ GetObject stream → archiver (store, CRC32) → Response stream
                     └ DB (pool max 3), Redis (slot counter), Supabase auth
```
Every byte crosses the app server twice (inbound from R2, outbound to the user).

## 2. Measured results 🟢

| Scenario | Throughput | CPU | Peak RSS |
|---|---|---|---|
| Plain 2 GB read (baseline) | very fast | – | 91 MB |
| 2 GB ZIP, unthrottled consumer | 562 MB/s | 107% (1 core) | 94 MB |
| 2 GB ZIP, 50 MB/s consumer | 50 MB/s | 20% | 95 MB |
| 400 MB ZIP, 5 MB/s consumer | 5 MB/s | 4% | 90 MB |
| 5,000 × 100 KB files (626 MB) | 242 MB/s | 133% | 111 MB |

Conclusions
- **Memory:** flat ≈ 90–110 MB regardless of size or consumer speed (backpressure works). 2 GB PM2 cap not at risk.
- **CPU:** ZIP build (CRC32, store mode) tops out ≈ 560 MB/s on one core. At realistic speeds, 4–20% of a core per download.
- **Slow consumer** = low CPU/RAM but a long-held connection and Redis slot.

## 3. Bottlenecks, ranked

| # | Bottleneck | Evidence | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Server network bandwidth** (in + out per byte) | 🟡 | 10 GB cap = 10 GB in + 10 GB out; ≈1.5 min at 1 Gbit, ≈14 min at 100 Mbit; competes with normal page traffic | Global concurrency cap; keep 10 GB limit; for single large files consider presigned R2 URLs |
| 2 | **Slow end-user connections** | 🟢 | 5 MB/s ⇒ 10 GB takes ≈33 min holding a connection + slot | Per-user cap (2) exists; add global cap; slot TTL refresh (done) |
| 3 | **nginx buffering on `location /`** | 🟡 ⚪ | Only `/api/cases/upload` sets `proxy_buffering off`. Relies on `X-Accel-Buffering: no` header; if ignored, up to 1 GB/download spills to nginx temp disk. Default `send_timeout` 60 s drops stalled clients | Add explicit `location` blocks for the two download routes with `proxy_buffering off`, longer `send_timeout`; verify in prod |
| 4 | **Time-to-first-byte** | 🟡 | Supabase `getUser` + DB + one R2 HEAD per file + ≈40 awaited activity-log queries on a DB pool of 3; HEADs repeated in preview and download | Don't await "started" logs; reuse/cache preview HEAD results |
| 5 | **Sequential file fetch** | 🟡 ⚪ | One R2 round-trip per file; thousands of small files ⇒ minutes | Acceptable at ≤20 cases; prefetch next object if needed |
| 6 | **Single Node event loop shared with the site** | 🟡 | Aggregate CRC/TLS work for all concurrent downloads shares one core with page rendering | Global cap; later move ZIP building to the worker process |
| 7 | **Cloudflare in front** | 🟡 | 100 s idle timeout only matters if first byte is slow; large binary traffic through a proxied domain may conflict with plan terms | Check plan terms; consider direct R2 presigned delivery |
| 8 | **DB writes per download** | 🟡 | 2 × `logActivity` per case, each = timeline `UPDATE` (rewrites jsonb) + `INSERT` | Batch inserts; skip timeline append for internal audit events |

## 4. Defects found

| Defect | Status |
|---|---|
| Client cancel mid-download hung the server loop (`archiver.abort()` emits nothing) → Redis slot leaked 2 h, no `failed` log. Reproduced 🟢 | **Fixed** — wait now settles on abort; slot TTL 15 min, refreshed per file; logged as `client_aborted` |
| Download opens in new tab via form POST; refusals (429/413) show raw JSON | Open (UX) |

## 5. Not covered / needs measurement ⚪
- Real R2 → server throughput (single stream and parallel).
- Production server NIC, CPU count, RAM.
- nginx + Cloudflare behaviour with the `X-Accel-Buffering` header.
- Behaviour with many concurrent users.

## 6. Action list

1. Production smoke test (2–5 GB): watch `pm2 monit`, `iftop`, nginx temp dir, time-to-first-byte.
2. Add nginx location blocks for both download routes (`proxy_buffering off`, `send_timeout 600s`).
3. Add a **global** concurrent-download cap (≈3–4) in Redis next to the per-user cap.
4. Make "started" activity logs non-blocking; reuse HEAD results from the preview step.
5. Decide on Cloudflare plan-terms question; if needed, evaluate presigned-URL delivery.

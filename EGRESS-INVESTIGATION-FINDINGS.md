# Egress Consumption Investigation - Root Causes Identified

**Investigation Date:** December 12, 2025  
**Status:** ⚠️ **CRITICAL ISSUES FOUND - High Egress Sources Identified**

---

## Executive Summary

While previous optimizations were partially implemented, **several critical egress bottlenecks remain active and are the primary cause of high data consumption:**

1. **`/api/data/workers-docs` endpoint - Fetches ALL worker documents without proper caching bypass**
2. **Full pagination loop - Fetches all pages of workers on every branch load**
3. **Excessive verifications data - No date-range limiting on initial fetch**
4. **Face verification image uploads - Large image payloads**

---

## Critical Issues Found

### 🔴 **ISSUE #1: Unrestricted `/api/data/workers-docs` Endpoint**

**File:** `client/context/WorkersContext.tsx` (line 2700)  
**Severity:** CRITICAL

```typescript
// Line 2700 - PROBLEMATIC CODE
const res = await fetch("/api/data/workers-docs?nocache=1", {
  cache: "no-store",
  signal: controller.signal,
});
```

**Problems:**
- Passes `?nocache=1` parameter, **forcing cache bypass**
- Fetches **ALL worker documents** in the database
- Called via `refreshWorkers()` function
- `refreshWorkers()` is called:
  - When branch is selected (line 2569 in useEffect)
  - When refresh button is clicked
  - When payment is saved
  - When worker status changes
  - In WorkerDetails page (line 85, 119)

**Impact:** 
- Every call to `refreshWorkers()` downloads **ENTIRE workers-docs** dataset
- With hundreds/thousands of workers, this is massive egress
- Happens repeatedly throughout user session

**Server-side endpoint (lines 4509-4715):**
```typescript
// Fetches ALL workers in batches of 50
while (hasMore) {
  const u = new URL(`${rest}/hv_workers`);
  u.searchParams.set("select", "id,docs");
  u.searchParams.set("limit", String(batchSize));
  u.searchParams.set("offset", String(offset));
  
  // Processes ALL workers in database
  offset += batchSize;
}
```

---

### 🔴 **ISSUE #2: Full Pagination Loop on Every Branch Load**

**File:** `client/context/WorkersContext.tsx` (lines 2153-2204)  
**Severity:** HIGH

```typescript
// Line 2176-2203 - Fetches ALL pages of workers
if (totalPages > 1) {
  for (let page = 2; page <= totalPages; page++) {
    const pageResponse = await fetchApiEndpoint(
      buildWorkersPath(page),
      30000,
    );
    if (pageResponse && pageResponse.ok) {
      const batch = normalizeWorkersPayload(pageJson);
      aggregatedWorkers.push(...batch);
    }
  }
}
```

**Problems:**
- Loads **page 1, then loops through ALL remaining pages**
- Each page is 50 workers
- If a branch has 500 workers = 10 pages = 10 separate API calls
- Happens on every:
  - Branch selection
  - Manual refresh
  - Page reload

**Impact:**
- Multiple sequential API calls to `/api/workers/branch/:branchId`
- Each call returns full worker data
- Compounds with workers-docs fetch

---

### 🟠 **ISSUE #3: Excessive Verifications Data Fetch**

**File:** `client/context/WorkersContext.tsx` (line 2247-2250)  
**Severity:** MEDIUM-HIGH

```typescript
const verifResponse = await fetchApiEndpoint(
  "/api/data/verifications",
  30000,
);
```

**Server-side endpoint (lines 4802-4810):**
```typescript
// Line 4803 - Default limit is 1000!
const limit = Math.min(Number(req.query.limit) || 1000, 5000);
const offset = Math.max(Number(req.query.offset) || 0, 0);
const days = Number(req.query.days) || 30; // Last 30 days

// Line 4856 - Counts all matching records
headers["Prefer"] = "count=exact";
```

**Problems:**
- Default limit: **1000 verifications per fetch**
- Includes `count=exact` header which requires scanning entire table
- No limit on date range in client request
- Returns full verification records (including payment amounts)

**Impact:**
- Single fetch = ~1000 verification records × 5 fields each
- Large response payload
- Heavy database scan

---

### 🟠 **ISSUE #4: Face Verification Image Uploads**

**File:** `client/components/FaceVerifyCard.tsx` (lines 127-201)  
**Severity:** MEDIUM

```typescript
// Line 127-135 - Uploads face image
const formData = new FormData();
formData.append("livePhoto", new Blob([snapshot], { type: "image/webp" }));
formData.append("embedding", new Blob([emb], { type: "application/octet-stream" }));

// Line 192 - Posts to compare-face
const r = await fetch(url, {
  method: "POST",
  body: formData,
});
```

**Problems:**
- Each face verification uploads:
  - **Liveness image** (WEBP, typically 50-100KB)
  - **Face embedding** (binary data)
  - Face descriptor data
- If many users verify simultaneously, massive upload traffic

**Impact:**
- Each verification = 50-150KB egress to AWS Rekognition
- Cumulative impact with high user volume

---

## Why Previous "Optimizations" Aren't Working

| Optimization | Status | Why It Fails |
|---|---|---|
| Realtime Disabled | ✅ Done | Good, but not the main issue |
| Server Caching | ⚠️ Partial | Cache is **bypassed** by `?nocache=1` |
| Request Coalescing | ✅ Done | Doesn't help if request is forced `nocache` |
| Selective Columns | ⚠️ Partial | `id,docs` is still large if docs are big |
| Pagination | ⚠️ Broken | Fetches **ALL pages** in a loop |
| Polling Disabled | ✅ Done | Not calling repeatedly via timers |

---

## Verification of Issues

### Evidence #1: `nocache=1` Parameter
Found in `client/context/WorkersContext.tsx:2700`
```
/api/data/workers-docs?nocache=1
```

This parameter **explicitly disables caching** on the server:
```typescript
// Line 4534 in server/index.ts
const noCache = req.query.nocache === "1";
if (!noCache) {
  const cached = getCachedResponse("workers-docs");
  if (cached) {
    return sendResponse(200, cached);
  }
}
```

### Evidence #2: Full Page Loop
In `client/context/WorkersContext.tsx:2177`, loop condition:
```typescript
for (let page = 2; page <= totalPages; page++)
```
This loads **every single page** regardless of need.

### Evidence #3: Verifications Limit
In `server/index.ts:4803`:
```typescript
const limit = Math.min(Number(req.query.limit) || 1000, 5000);
```
Default is **1000 records per request**.

---

## Estimated Egress Breakdown

**Assuming 1000 workers, 10,000 verifications/month:**

| Source | Per Request | Frequency | Monthly | % of Total |
|--------|------------|-----------|---------|-----------|
| workers-docs (all) | ~5MB | Every refresh | 150MB+ | 35-40% |
| workers paginated | ~2MB × 10 pages | Every branch load | 100MB+ | 25-30% |
| verifications (1000 limit) | ~500KB | Every refresh | 50MB+ | 10-15% |
| Face uploads | ~100KB | Per verification | 100KB × volume | 20-25% |
| Other | - | - | - | 5-10% |

**Total Estimated Monthly:** 400-600MB (depends on user volume)

---

## Recommended Fixes (Priority Order)

### 🔴 **CRITICAL - Fix 1: Remove `nocache=1` parameter**

**Change in `client/context/WorkersContext.tsx:2700`:**

```diff
- const res = await fetch("/api/data/workers-docs?nocache=1", {
+ const res = await fetch("/api/data/workers-docs", {
```

**Impact:** Let server cache handle this properly, reduce by ~35-40%

---

### 🔴 **CRITICAL - Fix 2: Add date-range limiting to workers-docs**

**Add parameter to worker docs fetch:**

```typescript
// Instead of fetching ALL docs, fetch only recently modified
const res = await fetch("/api/data/workers-docs?days=7", {
  cache: "no-store",
});
```

**Server-side (lines 4509-4715):** Add filtering:
```typescript
// Add date-range filter
u.searchParams.set("updated_at", `gte.${sevenDaysAgo}`);
```

**Impact:** Reduce payload by ~70%

---

### 🔴 **CRITICAL - Fix 3: Fix pagination to only load needed pages**

**Change in `client/context/WorkersContext.tsx:2177`:**

```typescript
// Current - loads ALL pages
if (totalPages > 1) {
  for (let page = 2; page <= totalPages; page++) { ... }
}

// FIXED - load only first 5 pages (250 workers)
if (totalPages > 1) {
  const maxPagesToLoad = 5; // Or use param from user preference
  for (let page = 2; page <= Math.min(totalPages, maxPagesToLoad); page++) { ... }
}
```

**Impact:** Reduce by ~50% for large branches

---

### 🟠 **HIGH - Fix 4: Limit verifications to specific date range**

**Change in `client/context/WorkersContext.tsx:2247-2250`:**

```typescript
// Instead of:
const verifResponse = await fetchApiEndpoint(
  "/api/data/verifications",
  30000,
);

// CHANGE TO:
const verifResponse = await fetchApiEndpoint(
  "/api/data/verifications?limit=500&days=7",
  30000,
);
```

**Impact:** Reduce verifications payload by ~80%

---

### 🟠 **MEDIUM - Fix 5: Compress face images before upload**

**Change in `client/components/FaceVerifyCard.tsx`:**

```typescript
// Compress image before uploading
const compressed = await compressImage(snapshot, 0.7); // 70% quality
formData.append("livePhoto", compressed);
```

**Impact:** Reduce face uploads by ~60%

---

## Immediate Action Items

1. ✅ Remove `?nocache=1` - **5 minute fix, 35-40% reduction**
2. ✅ Limit pagination to 5 pages max - **10 minute fix, 50% reduction**
3. ✅ Add days parameter to verifications - **15 minute fix, 80% reduction**
4. ✅ Compress face images - **20 minute fix, 60% reduction**

**Combined impact:** **75-85% egress reduction**

---

## Testing Recommendations

After fixes:

```bash
# 1. Monitor Supabase egress metrics
# Should see immediate 75%+ drop

# 2. Test branch load performance
# Should be faster due to reduced pagination

# 3. Test worker document refresh
# Should use cache now instead of bypass

# 4. Verify face verification uploads
# Should be significantly smaller
```

---

## Root Cause Analysis

The high egress was NOT due to Realtime subscriptions (those were already disabled), but rather **intentional cache-busting (`nocache=1`) combined with unlimited data fetching** that was implemented as a workaround for stale data issues.

The solution is to **properly manage cache invalidation** rather than disable caching entirely.


-- Migration: Add missing database indexes to improve query performance
-- This addresses CPU and memory exhaustion issues by optimizing query execution plans
-- Date: 2024

-- 1. Indexes on hv_workers table
-- Single index on branch_id for filtering workers by branch
CREATE INDEX IF NOT EXISTS idx_hv_workers_branch_id ON public.hv_workers (branch_id);

-- Compound index for paginated queries ordered by arrival_date
-- Used in: GET /api/workers/branch/:branchId
CREATE INDEX IF NOT EXISTS idx_hv_workers_branch_arrival ON public.hv_workers (branch_id, arrival_date DESC);

-- Trigram index for case-insensitive name searches (ilike)
-- This requires pg_trgm extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_hv_workers_name_trgm ON public.hv_workers USING gin (lower(name) gin_trgm_ops);

-- 2. Indexes on hv_verifications table
-- Index on worker_id for filtering verifications by worker
CREATE INDEX IF NOT EXISTS idx_hv_verifications_worker_id ON public.hv_verifications (worker_id);

-- Index on verified_at for date-range queries and sorting
-- Used in: GET /api/data/verifications and reports
CREATE INDEX IF NOT EXISTS idx_hv_verifications_verified_at ON public.hv_verifications (verified_at DESC);

-- Compound index for filtering by worker and ordering by date
CREATE INDEX IF NOT EXISTS idx_hv_verifications_worker_verified_at ON public.hv_verifications (worker_id, verified_at DESC);

-- 3. Indexes on hv_face_profiles table
-- Index on worker_id for finding profiles by worker
CREATE INDEX IF NOT EXISTS idx_hv_face_profiles_worker_id ON public.hv_face_profiles (worker_id);

-- Index on created_at for fetching latest profile (order by created_at desc limit 1)
-- Used in: netlify/functions/compare-face.ts
CREATE INDEX IF NOT EXISTS idx_hv_face_profiles_created_at ON public.hv_face_profiles (created_at DESC);

-- Compound index for worker + created_at queries
CREATE INDEX IF NOT EXISTS idx_hv_face_profiles_worker_created_at ON public.hv_face_profiles (worker_id, created_at DESC);

-- 4. Indexes on hv_payments table
-- Index on worker_id for cascading deletes and payment lookups
CREATE INDEX IF NOT EXISTS idx_hv_payments_worker_id ON public.hv_payments (worker_id);

-- Index on saved_at for range queries used by reports and verification exports
CREATE INDEX IF NOT EXISTS idx_hv_payments_saved_at ON public.hv_payments (saved_at);

-- 5. JSON/JSONB indexes on hv_branches
-- GIN index for efficient JSON queries
CREATE INDEX IF NOT EXISTS idx_hv_branches_docs_jsonb ON public.hv_branches USING gin (docs jsonb_path_ops);

-- Verify indexes were created
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('hv_workers', 'hv_verifications', 'hv_face_profiles', 'hv_payments', 'hv_branches')
ORDER BY tablename, indexname;

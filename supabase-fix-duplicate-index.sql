-- Fix: Drop duplicate index on hv_workers table
-- Issue: idx_hv_workers_branch_arrival and idx_hv_workers_branch_arrival_desc are identical
-- Solution: Keep idx_hv_workers_branch_arrival (standard naming), drop idx_hv_workers_branch_arrival_desc

-- Verify indexes before dropping
SELECT 
  indexname,
  indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND tablename = 'hv_workers'
  AND indexname IN ('idx_hv_workers_branch_arrival', 'idx_hv_workers_branch_arrival_desc');

-- Drop the duplicate/redundant index
DROP INDEX CONCURRENTLY IF EXISTS public.idx_hv_workers_branch_arrival_desc;

-- Verify remaining indexes
SELECT 
  indexname,
  indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND tablename = 'hv_workers'
ORDER BY indexname;

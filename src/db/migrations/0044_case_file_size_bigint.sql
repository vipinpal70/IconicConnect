-- case_files.file_size held byte counts as int4 (max 2,147,483,647 ≈ 2.14GB),
-- which overflowed for multi-GB uploads (SQLSTATE 22003). Widen to bigint.
ALTER TABLE "case_files" ALTER COLUMN "file_size" SET DATA TYPE bigint;

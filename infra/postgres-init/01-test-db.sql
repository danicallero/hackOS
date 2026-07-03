-- Created once on first boot of the postgres volume. The test harness
-- resets its contents (drop schema public cascade) on every run.
CREATE DATABASE hackos_test OWNER hackos;

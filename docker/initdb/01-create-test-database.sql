-- Runs once, when the Postgres container starts with an empty data volume.
-- The dev database comes from POSTGRES_DB; this adds the test database
-- that .env.test points at. Tests may only touch databases ending in _test.
CREATE DATABASE miseenplace_test;

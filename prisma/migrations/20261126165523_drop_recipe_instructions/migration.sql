-- Phase 1's method text goes (spec §7.2; plan Step 26).
--
-- instructions_to_steps copied each recipe's text into a "Method" section of
-- steps, and left the column in place until the result had been checked on
-- the Pi, against the real recipes. With that done, nothing reads the column,
-- so it's dropped. The backup deploy.sh takes before migrating still holds
-- the text, if it's ever wanted.

-- AlterTable
ALTER TABLE "Recipe" DROP COLUMN "instructions";

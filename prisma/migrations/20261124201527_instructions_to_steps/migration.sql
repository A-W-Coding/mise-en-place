-- Phase 1's method text moves into sections and steps (spec §7.2; plan Step 20).
--
-- Every recipe with instructions gets one section, "Method", with a step for
-- each line, in order, following the rules the recipe page used to show them:
-- each line is trimmed, a leading "1." or "2)" is dropped, and lines left
-- empty are skipped. A recipe with no steps left gets no section.
--
-- Recipe.instructions is left as it was, so the text survives until the result
-- has been checked on the Pi; a later migration drops it (Step 26). A test
-- (tests/instructions-migration.test.ts) runs this file's SQL on recipes made
-- with instructions.
WITH "lines" AS (
    SELECT r."id" AS "recipeId", l."line", l."n"
    FROM "Recipe" r
    CROSS JOIN LATERAL regexp_split_to_table(r."instructions", E'\r?\n') WITH ORDINALITY AS l("line", "n")
    WHERE r."instructions" IS NOT NULL
),
"cleaned" AS (
    SELECT "recipeId", "n",
           regexp_replace(regexp_replace("line", '^\s+|\s+$', '', 'g'), '^\d+\s*[.)]\s*', '') AS "text"
    FROM "lines"
),
"kept" AS (
    SELECT "recipeId", "text",
           (row_number() OVER (PARTITION BY "recipeId" ORDER BY "n") - 1)::integer AS "orderIndex"
    FROM "cleaned"
    WHERE "text" <> ''
),
"sections" AS (
    INSERT INTO "RecipeSection" ("id", "recipeId", "name", "orderIndex")
    SELECT gen_random_uuid()::text, "recipeId", 'Method', 0
    FROM (SELECT DISTINCT "recipeId" FROM "kept") AS "withSteps"
    RETURNING "id", "recipeId"
)
INSERT INTO "Instruction" ("id", "sectionId", "orderIndex", "text", "timerSeconds")
SELECT gen_random_uuid()::text, s."id", k."orderIndex", k."text", NULL
FROM "kept" k
JOIN "sections" s ON s."recipeId" = k."recipeId";

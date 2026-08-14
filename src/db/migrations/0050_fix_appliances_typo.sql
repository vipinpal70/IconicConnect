-- Fix "Spot Guards" typo in the Appliances catalog — should be "Sport
-- Guards" (see case-creation-service-enforcement-plan.md §1/§4). Renaming
-- the string is safe: client_price_list references service_catalog by
-- catalogItemId, not by category/sub_category string, so no FK is affected.
UPDATE "service_catalog" SET "sub_category" = 'Sport Guards' WHERE "sub_category" = 'Spot Guards';
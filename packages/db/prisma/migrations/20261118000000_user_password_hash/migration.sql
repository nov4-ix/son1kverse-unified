-- Hardening v1: una sola columna de credenciales y Stripe solo en User.
--
-- La columna "passwordHash" de SSV-BETA nunca se escribió (los usuarios se
-- crean con scrypt en "password"). Se elimina el duplicado vacío y se renombra
-- la columna real para que el schema y la base tengan un único nombre.
ALTER TABLE "User" DROP COLUMN IF EXISTS "passwordHash";
ALTER TABLE "User" RENAME COLUMN "password" TO "passwordHash";

-- La fuente de verdad de Stripe es User.stripeCustomerId.
ALTER TABLE "AlvaeAccount" DROP COLUMN IF EXISTS "stripeCustomerId";

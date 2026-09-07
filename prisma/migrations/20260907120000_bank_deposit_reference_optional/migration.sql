-- A bank slip number is routinely not to hand at the moment the cash leaves
-- the drawer. Requiring it up front only meant the trip went unrecorded
-- until someone dug the slip out, which is the opposite of what the deposit
-- record exists for. The reference stays UNIQUE: Postgres allows many NULLs
-- under a unique index, so every reference that does exist is still bound to
-- exactly one deposit.
ALTER TABLE "BankDeposit" ALTER COLUMN "reference" DROP NOT NULL;

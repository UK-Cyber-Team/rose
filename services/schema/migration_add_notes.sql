-- Migration to add notes column to flow table
-- Run this if you have an existing Tulip database

-- Add notes column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='flow' AND column_name='notes') THEN
        ALTER TABLE flow ADD COLUMN notes text NOT NULL DEFAULT '';
        RAISE NOTICE 'Added notes column to flow table';
    ELSE
        RAISE NOTICE 'notes column already exists in flow table';
    END IF;
END $$;

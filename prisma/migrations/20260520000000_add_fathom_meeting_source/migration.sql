-- Add 'fathom' as a valid MeetingSource. Captures schema drift that previously
-- existed only on production (applied ad-hoc via ALTER TYPE).
ALTER TYPE "meeting_source" ADD VALUE IF NOT EXISTS 'fathom';

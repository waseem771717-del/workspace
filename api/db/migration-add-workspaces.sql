-- Migration script to add workspace support to existing database
-- Run this after deploying the new schema files

-- Step 1: Add workspace_id column to documents (nullable for backward compatibility)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='documents' AND column_name='workspace_id'
  ) THEN
    ALTER TABLE documents ADD COLUMN workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace_id);
  END IF;
END $$;

-- Step 2: Add document_filename to chunks
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='document_chunks' AND column_name='document_filename'
  ) THEN
    ALTER TABLE document_chunks ADD COLUMN document_filename TEXT;
    
    -- Backfill document_filename from documents table
    UPDATE document_chunks dc
    SET document_filename = d.filename
    FROM documents d
    WHERE dc.document_id = d.id;
    
    -- Make it NOT NULL after backfill
    ALTER TABLE document_chunks ALTER COLUMN document_filename SET NOT NULL;
  END IF;
END $$;

-- Step 3: Create default workspace for each user with existing documents
INSERT INTO workspaces (user_id, name, description)
SELECT DISTINCT user_id, 'My Documents', 'Default workspace for existing documents'
FROM documents
WHERE workspace_id IS NULL
ON CONFLICT DO NOTHING;

-- Step 4: Associate orphaned documents with default workspace
UPDATE documents d
SET workspace_id = (
  SELECT id FROM workspaces w 
  WHERE w.user_id = d.user_id 
  AND w.name = 'My Documents'
  LIMIT 1
)
WHERE workspace_id IS NULL;

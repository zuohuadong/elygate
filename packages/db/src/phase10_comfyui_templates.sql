-- Phase 10: ComfyUI Workflow Templates Implementation
-- This script creates the table for storing ComfyUI workflow templates as part of the integration.

CREATE TABLE IF NOT EXISTS workflow_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    group_name TEXT DEFAULT 'default', -- For organizational purposes
    template_json JSONB NOT NULL, -- The original ComfyUI workflow JSON
    input_parameters JSONB NOT NULL DEFAULT '[]', -- List of {name, path, type, default}
    provider_type INTEGER NOT NULL DEFAULT 100, -- Defaulting to ComfyUI (100)
    user_id UUID, -- Optional: template owner if personal
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for searching templates by name or group
CREATE INDEX IF NOT EXISTS idx_workflow_templates_name ON workflow_templates(name);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_group ON workflow_templates(group_name);

-- Comment explaining the table
COMMENT ON TABLE workflow_templates IS 'Stores ComfyUI workflow templates with mapping logic for parameter injection.';

-- Update the startup patches array in index.ts (to be done in code)

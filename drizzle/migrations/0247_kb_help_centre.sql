-- Knowledge Base as a help centre (2026-10-29): Category -> Folder -> Article.
-- Platform-level content authored by AINA super admins (no tenant_id, so no RLS,
-- same as kb_articles). Articles keep their series / episode for the KAIZEN
-- stories; `folder_id` places any article in the tree.
CREATE TABLE IF NOT EXISTS kb_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL,
  name        text NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  published   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kb_categories_slug_unique ON kb_categories (lower(slug));

CREATE TABLE IF NOT EXISTS kb_folders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES kb_categories(id) ON DELETE CASCADE,
  slug        text NOT NULL,
  name        text NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  published   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kb_folders_slug_unique ON kb_folders (lower(slug));
CREATE INDEX IF NOT EXISTS kb_folders_category_idx ON kb_folders (category_id, sort_order);

ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES kb_folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS kb_articles_folder_idx ON kb_articles (folder_id, sort_order);

-- The existing KAIZEN stories become one folder so nothing disappears.
INSERT INTO kb_categories (slug, name, description, sort_order)
VALUES ('kaizen', 'KAIZEN', 'Real situations from an MFD practice and how Aina CRM handles each one.', 900)
ON CONFLICT DO NOTHING;

INSERT INTO kb_folders (category_id, slug, name, sort_order)
SELECT c.id, 'kaizen-stories', 'KAIZEN stories', 0 FROM kb_categories c WHERE lower(c.slug) = 'kaizen'
ON CONFLICT DO NOTHING;

UPDATE kb_articles a
   SET folder_id = f.id
  FROM kb_folders f
 WHERE lower(f.slug) = 'kaizen-stories' AND a.folder_id IS NULL AND upper(a.series) = 'KAIZEN';

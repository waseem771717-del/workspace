CREATE TABLE IF NOT EXISTS video_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  youtube_url TEXT NOT NULL,
  video_id VARCHAR(20) NOT NULL,
  video_title TEXT,
  thumbnail_url TEXT,
  summary_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_summaries_user ON video_summaries(user_id);
CREATE INDEX IF NOT EXISTS idx_summaries_created ON video_summaries(created_at DESC);

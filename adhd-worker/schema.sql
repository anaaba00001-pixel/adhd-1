CREATE TABLE IF NOT EXISTS private_guide_progress (
    access_hash TEXT PRIMARY KEY NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    payload TEXT NOT NULL CHECK (json_valid(payload))
);

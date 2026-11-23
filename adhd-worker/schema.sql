CREATE TABLE IF NOT EXISTS private_guide_progress (
    access_hash TEXT PRIMARY KEY NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    payload TEXT NOT NULL CHECK (json_valid(payload))
);

-- عداد يومي واحد لحماية حصة الاستدعاءات على الموقع العام.
CREATE TABLE IF NOT EXISTS guide_ai_budget (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    day TEXT NOT NULL,
    requests INTEGER NOT NULL CHECK (requests > 0)
);

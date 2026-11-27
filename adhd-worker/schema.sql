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

CREATE TABLE IF NOT EXISTS analytics_daily (
    day TEXT NOT NULL,
    path TEXT NOT NULL,
    event TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
    PRIMARY KEY (day, path, event)
);

CREATE TABLE IF NOT EXISTS error_daily (
    day TEXT NOT NULL,
    path TEXT NOT NULL,
    code TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
    PRIMARY KEY (day, path, code)
);

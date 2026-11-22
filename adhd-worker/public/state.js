function validState(state) {
    const record = (value, check, pattern) => value && typeof value === "object" && !Array.isArray(value)
        && Object.entries(value).every(([key, entry]) => pattern.test(key) && check(entry));
    const exercise = /^(?:t)?\d+-\d+$/;
    return state && Number.isInteger(state.wk) && state.wk >= 0 && state.wk < 12
        && ["prog", "dash", "ai", "idx", "sheets", "guide"].includes(state.tab)
        && record(state.done, v => typeof v === "boolean", exercise)
        && record(state.notes, v => typeof v === "string", exercise)
        && record(state.sheets, rows => Array.isArray(rows) && rows.every(row =>
            Array.isArray(row) && row.every(cell => typeof cell === "string")), /^\d+$/);
}
export { validState };

const STORAGE_KEY = "protectedPatterns";
const DEFAULT_PROTECTED_PATTERNS = [
    "localhost",
    "uriel1998.github.io",
];

const patternsField = document.getElementById("patterns");
const statusField = document.getElementById("status");
const saveButton = document.getElementById("save");
const resetButton = document.getElementById("reset");

function normalizePatternEntry(entry) {
    return typeof entry === "string" ? entry.trim() : "";
}

function isHostnameShorthand(entry) {
    return /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(entry);
}

function isHostPathShorthand(entry) {
    return /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(\/.*)$/i.test(entry);
}

function normalizeForValidation(entry) {
    if (entry === "<all_urls>") {
        return entry;
    }

    if (isHostnameShorthand(entry)) {
        return `*://${entry}/*`;
    }

    if (isHostPathShorthand(entry)) {
        return `*://${entry}`;
    }

    return entry;
}

function validateMatchPattern(pattern) {
    if (pattern === "<all_urls>") {
        return true;
    }

    const match = /^(\*|http|https|ws|wss|ftp|file):\/\/([^/]*)(\/.*)$/.exec(pattern);
    if (!match) {
        throw new Error("not a supported match pattern");
    }

    const [, scheme, host] = match;

    if (scheme === "file") {
        if (host !== "") {
            throw new Error("file patterns must look like file:///path/*");
        }
        return true;
    }

    if (!host) {
        throw new Error("host is required");
    }

    if (host.includes("*") && host !== "*" && !host.startsWith("*.")) {
        throw new Error("host wildcard must be '*' or begin with '*.'");
    }

    return true;
}

function parseEditorValue(value) {
    const entries = [];
    const errors = [];

    for (const [index, line] of value.split(/\r?\n/u).entries()) {
        const entry = normalizePatternEntry(line);
        if (!entry || entry.startsWith("#")) {
            continue;
        }

        try {
            validateMatchPattern(normalizeForValidation(entry));
            entries.push(entry);
        } catch (error) {
            errors.push(`Line ${index + 1}: "${entry}" ${error.message}.`);
        }
    }

    return { entries, errors };
}

function setStatus(message, type = "") {
    statusField.textContent = message;
    statusField.className = `status${type ? ` ${type}` : ""}`;
}

async function loadOptions() {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const patterns = STORAGE_KEY in stored
        ? stored[STORAGE_KEY]
        : DEFAULT_PROTECTED_PATTERNS;

    patternsField.value = Array.isArray(patterns) ? patterns.join("\n") : "";
    setStatus("");
}

async function saveOptions() {
    const { entries, errors } = parseEditorValue(patternsField.value);

    if (errors.length > 0) {
        setStatus(errors.join("\n"), "error");
        return;
    }

    await browser.storage.local.set({
        [STORAGE_KEY]: entries,
    });

    patternsField.value = entries.join("\n");
    setStatus("Saved protected patterns.", "success");
}

async function resetDefaults() {
    await browser.storage.local.set({
        [STORAGE_KEY]: DEFAULT_PROTECTED_PATTERNS,
    });

    await loadOptions();
    setStatus("Defaults restored.", "success");
}

saveButton.addEventListener("click", () => {
    saveOptions().catch((error) => {
        setStatus(`Save failed: ${error.message}`, "error");
    });
});

resetButton.addEventListener("click", () => {
    resetDefaults().catch((error) => {
        setStatus(`Reset failed: ${error.message}`, "error");
    });
});

document.addEventListener("DOMContentLoaded", () => {
    loadOptions().catch((error) => {
        setStatus(`Load failed: ${error.message}`, "error");
    });
});

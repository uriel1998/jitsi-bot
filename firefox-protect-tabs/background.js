const STORAGE_KEY = "protectedPatterns";
const DEFAULT_PROTECTED_PATTERNS = [
    "localhost",
    "uriel1998.github.io",
];

let activePatterns = [];

function normalizePatternEntry(entry) {
    return typeof entry === "string" ? entry.trim() : "";
}

function isHostnameShorthand(entry) {
    return /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(entry);
}

function isHostPathShorthand(entry) {
    return /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(\/.*)$/i.test(entry);
}

function escapeRegex(value) {
    return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function wildcardToRegex(value) {
    return new RegExp(`^${escapeRegex(value).replace(/\*/g, ".*")}$`);
}

function compileMatchPattern(pattern) {
    if (pattern === "<all_urls>") {
        return {
            pattern,
            test(urlString) {
                try {
                    const url = new URL(urlString);
                    return [
                        "http:",
                        "https:",
                        "ws:",
                        "wss:",
                        "ftp:",
                        "file:",
                    ].includes(url.protocol);
                } catch (error) {
                    return false;
                }
            },
        };
    }

    const match = /^(\*|http|https|ws|wss|ftp|file):\/\/([^/]*)(\/.*)$/.exec(pattern);
    if (!match) {
        throw new Error("Pattern must use a supported WebExtension match-pattern format.");
    }

    const [, scheme, host, path] = match;
    const allowedProtocols =
        scheme === "*"
            ? ["http:", "https:", "ws:", "wss:", "ftp:"]
            : [`${scheme}:`];
    const pathRegex = wildcardToRegex(path);

    if (scheme === "file") {
        if (host !== "") {
            throw new Error("File patterns must be written like file:///path/*.");
        }

        return {
            pattern,
            test(urlString) {
                try {
                    const url = new URL(urlString);
                    const testPath = `${url.pathname}${url.search}${url.hash}`;
                    return url.protocol === "file:" && pathRegex.test(testPath);
                } catch (error) {
                    return false;
                }
            },
        };
    }

    if (!host) {
        throw new Error("A host is required for this URL pattern.");
    }

    if (host.includes("*") && host !== "*" && !host.startsWith("*.")) {
        throw new Error("Host wildcards must be '*' or start with '*.'.");
    }

    const hostMatches =
        host === "*"
            ? () => true
            : host.startsWith("*.")
                ? (hostname) => hostname === host.slice(2) || hostname.endsWith(`.${host.slice(2)}`)
                : (hostname) => hostname === host;

    return {
        pattern,
        test(urlString) {
            try {
                const url = new URL(urlString);
                const testPath = `${url.pathname}${url.search}${url.hash}` || "/";
                return allowedProtocols.includes(url.protocol)
                    && hostMatches(url.hostname)
                    && pathRegex.test(testPath);
            } catch (error) {
                return false;
            }
        },
    };
}

function normalizeForMatching(entry) {
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

function compilePatternEntries(entries) {
    const compiled = [];
    const invalid = [];

    for (const rawEntry of entries) {
        const entry = normalizePatternEntry(rawEntry);
        if (!entry) {
            continue;
        }

        const normalized = normalizeForMatching(entry);

        try {
            compiled.push(compileMatchPattern(normalized));
        } catch (error) {
            invalid.push({
                entry,
                message: error.message,
            });
        }
    }

    return { compiled, invalid };
}

async function ensureStoredDefaults() {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    if (!(STORAGE_KEY in stored)) {
        await browser.storage.local.set({
            [STORAGE_KEY]: DEFAULT_PROTECTED_PATTERNS,
        });
        return DEFAULT_PROTECTED_PATTERNS;
    }

    return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
}

async function refreshPatterns() {
    const entries = await ensureStoredDefaults();
    const { compiled, invalid } = compilePatternEntries(entries);

    activePatterns = compiled;

    if (invalid.length > 0) {
        console.warn("Ignoring invalid protected patterns:", invalid);
    }
}

function shouldProtect(urlString) {
    if (!urlString) {
        return false;
    }

    return activePatterns.some((pattern) => pattern.test(urlString));
}

async function protectTab(tab) {
    if (!tab || typeof tab.id !== "number" || !tab.url) {
        return;
    }

    const protect = shouldProtect(tab.url);
    if (tab.autoDiscardable === !protect) {
        return;
    }

    try {
        await browser.tabs.update(tab.id, {
            autoDiscardable: !protect,
        });
        console.log(`${protect ? "Protected" : "Unprotected"} tab ${tab.id}: ${tab.url}`);
    } catch (error) {
        console.error(`Failed to update tab ${tab.id}:`, error);
    }
}

async function protectAllExistingTabs() {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
        await protectTab(tab);
    }
}

browser.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === "complete") {
        await protectTab(tab);
    }
});

browser.tabs.onCreated.addListener(async (tab) => {
    await protectTab(tab);
});

browser.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== "local" || !(STORAGE_KEY in changes)) {
        return;
    }

    await refreshPatterns();
    await protectAllExistingTabs();
});

browser.runtime.onInstalled.addListener(async () => {
    await refreshPatterns();
    await protectAllExistingTabs();
});

refreshPatterns()
    .then(() => protectAllExistingTabs())
    .catch((error) => {
        console.error("Initial protection pass failed:", error);
    });

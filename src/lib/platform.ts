// ============================================================
// platform.ts — The launcher runs on Windows and macOS; a few
// things look and read differently on each.
// ============================================================

/** Running on a Mac (WebKit's user agent says "Macintosh", WebView2's "Windows") */
export const isMac = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent)

/** What players call their computer: "this Mac" / "this PC" */
export const device = isMac ? 'Mac' : 'PC'

/** The operating system, for sentences like "leaves macOS too little" */
export const osName = isMac ? 'macOS' : 'Windows'

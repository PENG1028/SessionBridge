import { execSync } from "child_process";

/**
 * Open a URL in the default browser.
 * Cross-platform: Windows, macOS, Linux.
 */
export function openBrowser(url: string): void {
  try {
    const cmd =
      process.platform === "win32" ? `start "" "${url}"`
      : process.platform === "darwin" ? `open "${url}"`
      : `xdg-open "${url}"`;

    execSync(cmd, { timeout: 3000, stdio: "ignore" });
  } catch {
    // Not critical — user can open the URL manually
  }
}

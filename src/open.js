// Opening files/URLs with the OS handler, and the default download folder.

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

/** Open a file or URL with the platform's default application. */
export function openPath(target) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", target]]
        : ["xdg-open", [target]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

/** Default output folder: `<Downloads>/Komiku` (override with KOMIKU_DOWNLOAD_DIR). */
export function downloadsDir() {
  return process.env.KOMIKU_DOWNLOAD_DIR || join(homedir(), "Downloads", "Komiku");
}

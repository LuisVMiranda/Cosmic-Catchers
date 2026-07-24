import { describe, expect, it, vi } from "vitest";
import profile from "../../desktop/profile.cjs";

function fakeFileSystem({ markerPresent = false, writeError = null } = {}) {
  return {
    access: vi.fn(() => markerPresent ? Promise.resolve() : Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }))),
    mkdir: vi.fn(() => Promise.resolve()),
    writeFile: vi.fn(() => writeError ? Promise.reject(writeError) : Promise.resolve())
  };
}

describe("desktop release profile", () => {
  it("creates a versioned, filesystem-safe profile path", () => {
    expect(profile.createReleaseProfileRoot({ appData: "C:\\Data", version: "1.0.0 beta" }))
      .toBe("C:\\Data\\Cosmic Catchers\\1.0.0-beta-fresh-v1");
    expect(profile.safeSegment("Release / 1")).toBe("release-1");
  });

  it("clears browser storage exactly once before marking a fresh profile", async () => {
    const fs = fakeFileSystem();
    const storageSession = { clearStorageData: vi.fn(() => Promise.resolve()) };
    await expect(profile.prepareReleaseProfile({
      storageSession,
      profileRoot: "C:\\Profile",
      version: "1.0.0",
      fs
    })).resolves.toBe(true);
    expect(storageSession.clearStorageData).toHaveBeenCalledWith({ storages: profile.STORAGE_TYPES });
    expect(fs.writeFile).toHaveBeenCalledWith(
      "C:\\Profile\\.cosmic-catchers-profile",
      JSON.stringify({ schema: profile.PROFILE_SCHEMA, version: "1.0.0" }),
      { flag: "wx" }
    );
  });

  it("preserves the same player's stats after first launch", async () => {
    const fs = fakeFileSystem({ markerPresent: true });
    const storageSession = { clearStorageData: vi.fn() };
    await expect(profile.prepareReleaseProfile({
      storageSession,
      profileRoot: "C:\\Profile",
      version: "1.0.0",
      fs
    })).resolves.toBe(false);
    expect(storageSession.clearStorageData).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("does not mark a profile when storage cleanup fails", async () => {
    const fs = fakeFileSystem();
    const storageSession = { clearStorageData: vi.fn(() => Promise.reject(new Error("blocked"))) };
    await expect(profile.prepareReleaseProfile({
      storageSession,
      profileRoot: "C:\\Profile",
      version: "1.0.0",
      fs
    })).rejects.toThrow("blocked");
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("tolerates another process winning the marker race", async () => {
    const fs = fakeFileSystem({ writeError: Object.assign(new Error("exists"), { code: "EEXIST" }) });
    await expect(profile.writeMarker({ markerPath: "C:\\Profile\\marker", version: "1.0.0", fs })).resolves.toBeUndefined();
  });
});

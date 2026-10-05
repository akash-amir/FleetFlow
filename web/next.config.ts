import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives in web/ inside the FleetFlow repo, which also has its
  // own (backend) package-lock.json at the repo root — without this,
  // Turbopack can't tell which lockfile marks the real workspace root and
  // warns on every build.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;

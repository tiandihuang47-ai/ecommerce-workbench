import type { NextConfig } from "next";

const isDesktopProductionBuild = process.env.DIRECTOR_DESKTOP_BUILD === "1";

const nextConfig: NextConfig = {
  distDir: isDesktopProductionBuild ? ".next-desktop" : ".next",
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["sharp"],
};

export default nextConfig;

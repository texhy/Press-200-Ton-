import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // drei is a barrel that can drag in troika / meshline / three-stdlib;
    // this materially cuts what actually lands in the chunk
    optimizePackageImports: ["@react-three/drei"],
  },
};
export default nextConfig;

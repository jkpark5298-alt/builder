import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
  // Blob SDK가 서버리스에서 env를 정상적으로 읽도록
  serverExternalPackages: ["@vercel/blob"],
};

export default nextConfig;

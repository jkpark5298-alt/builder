import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Blob SDK·PDF 추출이 서버리스에서 정상 동작하도록
  serverExternalPackages: ["@vercel/blob", "unpdf"],
};

export default nextConfig;

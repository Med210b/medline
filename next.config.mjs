/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.MOBILE_APP === 'true' ? 'export' : 'standalone',
  images: {
    unoptimized: process.env.MOBILE_APP === 'true',
  },
};

export default nextConfig;

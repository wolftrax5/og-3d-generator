import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

/** Absolute OpenGraph URLs need a base; Vercel exposes the deployment host. */
const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : `http://localhost:${process.env.PORT ?? 3000}`;

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: '3D OpenGraph Image Generator',
  description:
    'OpenGraph images. A Satori preview is returned immediately; a WebGPU frame is rendered in a sandbox and stored in Blob.',
  openGraph: {
    images: ['/api/og-3d?shape=torusknot&color=6366f1&metalness=0.9&roughness=0.2'],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

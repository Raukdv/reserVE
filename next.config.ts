import type { NextConfig } from 'next'

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined

const nextConfig: NextConfig = {
  // `next dev` y `next build` escriben en el mismo directorio por defecto, así
  // que compilar mientras el servidor de desarrollo está levantado le pisa los
  // artefactos: el cliente acaba con chunks de producción contra un servidor en
  // modo desarrollo y la página revienta con "Failed to read a RSC payload
  // created by a development version of React".
  //
  // Las compilaciones de verificación usan NEXT_DIST_DIR=.next-verify y quedan
  // aisladas del servidor que esté corriendo.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: 'https', hostname: supabaseHost, pathname: '/storage/v1/object/public/**' }]
      : [],
  },
}

export default nextConfig

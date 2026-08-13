import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Puerta de acceso al sitio entero, para mantenerlo privado durante el desarrollo.
 *
 * Vercel protege los previews y las URLs *.vercel.app, pero **no el dominio
 * propio en producción** salvo en el plan Pro. Esto lo cubre sin coste.
 *
 * Es una barrera contra visitantes casuales y rastreadores, no seguridad de
 * verdad: la contraseña se comparte y viaja en cada petición. Lo que protege el
 * panel sigue siendo la sesión de Supabase con su comprobación de rol.
 *
 * Se activa solo si `SITE_PASSWORD` existe. Al abrir el sitio al público, se
 * borra esa variable y la puerta desaparece.
 */
function gateResponse() {
  return new NextResponse('Acceso restringido', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="reserVE", charset="UTF-8"',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

function passesGate(request: NextRequest, password: string) {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Basic ')) return false

  try {
    const decoded = atob(header.slice(6))
    // El usuario da igual; lo que se comprueba es la contraseña.
    return decoded.slice(decoded.indexOf(':') + 1) === password
  } catch {
    return false
  }
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  const password = process.env.SITE_PASSWORD

  // Los endpoints de máquina llevan su propia autenticación y no pueden mandar
  // Basic: Stripe firma el webhook, y el cron usa CRON_SECRET.
  const isMachineEndpoint =
    path.startsWith('/api/webhooks/') || path.startsWith('/api/cron/')

  if (password && !isMachineEndpoint && !passesGate(request, password)) {
    return gateResponse()
  }

  let response = NextResponse.next({ request })

  // Mientras la puerta esté puesta, nada debe indexarse.
  if (password) response.headers.set('X-Robots-Tag', 'noindex, nofollow')

  if (!path.startsWith('/admin')) return response

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          if (password) response.headers.set('X-Robots-Tag', 'noindex, nofollow')
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // getUser() valida el token contra Supabase; getSession() solo lee la cookie y
  // se puede falsificar. En middleware siempre getUser().
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const login = request.nextUrl.clone()
    login.pathname = '/login'
    login.searchParams.set('next', path)
    return NextResponse.redirect(login)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

export const config = {
  // Todo el sitio, porque la puerta de acceso tiene que cubrirlo entero.
  //
  // Cuando se abra al público y desaparezca `SITE_PASSWORD`, conviene volver a
  // restringirlo a '/admin/:path*': una invocación por visita pública es
  // desperdicio de cuota (docs/COSTO-CERO.md, regla 3.3). Mientras el sitio sea
  // privado el tráfico es mínimo, y bloquear rastreadores ahorra más de lo que
  // cuesta.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
}

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
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

  const path = request.nextUrl.pathname

  if (path.startsWith('/admin')) {
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
  }

  return response
}

export const config = {
  // Solo las rutas que necesitan sesión.
  //
  // Un matcher amplio ejecuta este middleware en cada visita pública, y cada
  // ejecución cuesta una invocación de función más una llamada de red a Supabase
  // para validar el token. Las páginas públicas no necesitan sesión, así que
  // pagarlo ahí es puro desperdicio de cuota y de latencia.
  //
  // Ver docs/COSTO-CERO.md, regla 3.3.
  matcher: ['/admin/:path*'],
}

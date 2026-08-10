/**
 * Documentos de identidad venezolanos.
 *
 * Se guarda **una sola cadena compuesta** —`V-27866046`— y el formulario se
 * encarga de armarla. Partirlo en dos columnas obligaría a migrar cuatro tablas
 * y las plantillas de correo a cambio de nada: nunca se filtra ni se agrupa por
 * tipo de documento.
 *
 * De los cuatro tipos **solo el RIF tiene algoritmo comprobable**. El resto son
 * formato y longitud. Inventar reglas más estrictas rechazaría documentos
 * legítimos, y en un checkout eso son reservas perdidas.
 */

export type DocumentType = 'V' | 'E' | 'J' | 'P'

export const DOCUMENT_TYPES: { value: DocumentType; label: string; short: string }[] = [
  { value: 'V', label: 'Venezolano — cédula', short: 'V' },
  { value: 'E', label: 'Extranjero residente — cédula', short: 'E' },
  { value: 'J', label: 'RIF jurídico — empresa', short: 'J' },
  { value: 'P', label: 'Pasaporte', short: 'P' },
]

/** Valor del prefijo dentro del cálculo del dígito verificador del RIF. */
const PREFIX_VALUE: Record<string, number> = { V: 1, E: 2, J: 3, P: 4, G: 5 }

/** Pesos por posición, definidos por el SENIAT. */
const WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2]

/**
 * Dígito verificador de un RIF, módulo 11.
 *
 * `body` son los 8 dígitos sin el verificador.
 */
export function rifCheckDigit(type: DocumentType, body: string): number {
  const sum =
    PREFIX_VALUE[type] * 4 +
    WEIGHTS.reduce((acc, weight, i) => acc + Number(body[i]) * weight, 0)

  const remainder = sum % 11
  const digit = 11 - remainder

  return digit > 9 ? 0 : digit
}

const onlyDigits = (value: string) => value.replace(/\D/g, '')

/** Normaliza lo tecleado: quita puntos, guiones y espacios. */
export function normalizeDocumentNumber(type: DocumentType, raw: string): string {
  const trimmed = raw.trim()
  return type === 'P'
    ? trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '')
    : onlyDigits(trimmed)
}

/**
 * Valida el número según su tipo.
 *
 * Devuelve `null` si es válido, o el motivo del rechazo.
 */
export function validateDocument(type: DocumentType, raw: string): string | null {
  const value = normalizeDocumentNumber(type, raw)

  if (!value) return 'Falta el número de documento'

  if (type === 'P') {
    // ICAO 9303 define el formato de la zona de lectura mecánica, no el número:
    // cada país emisor lo asigna a su manera, y los más largos se desbordan a un
    // campo opcional. Limitar a 9 rechazaría pasaportes válidos.
    if (!/^[A-Z0-9]{5,20}$/.test(value)) {
      return 'El pasaporte debe tener entre 5 y 20 caracteres alfanuméricos'
    }
    return null
  }

  if (type === 'J') {
    if (value.length !== 9) {
      return 'El RIF jurídico son 8 dígitos más el verificador: J-12345678-9'
    }
    const expected = rifCheckDigit('J', value.slice(0, 8))
    if (Number(value[8]) !== expected) {
      return 'El RIF no parece correcto, revisa los dígitos'
    }
    return null
  }

  // Cédula: número correlativo, **sin dígito verificador**. No hay nada más que
  // comprobar que el formato.
  if (value.length >= 5 && value.length <= 9) return null

  // Con 10 dígitos es un RIF personal, no una cédula: ahí sí hay verificador.
  if (value.length === 10) {
    const expected = rifCheckDigit(type, value.slice(1, 9))
    return Number(value[9]) === expected
      ? null
      : 'El RIF personal no parece correcto, revisa los dígitos'
  }

  return 'La cédula debe tener entre 5 y 9 dígitos'
}

/** Arma el valor que se guarda: `V-27866046`. */
export function composeDocument(type: DocumentType, raw: string): string | null {
  const value = normalizeDocumentNumber(type, raw)
  return value ? `${type}-${value}` : null
}

/** Descompone un valor guardado para precargar el formulario. */
export function parseDocument(value: string | null | undefined): {
  type: DocumentType
  number: string
} {
  const match = value?.trim().match(/^([VEJPG])-?(.+)$/i)

  if (!match) return { type: 'V', number: value?.trim() ?? '' }

  const type = match[1].toUpperCase()
  return {
    // G existe en RIF gubernamentales, pero no se ofrece: aquí no aplica.
    type: (type === 'G' ? 'J' : type) as DocumentType,
    number: match[2].trim(),
  }
}

/**
 * Valida un valor ya compuesto, tal como llega del formulario.
 *
 * Se usa en el servidor: el cliente se puede saltar, y un documento inválido
 * acaba en una factura.
 */
export function documentError(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null // vacío es válido donde es opcional

  const { type, number } = parseDocument(value)
  if (!DOCUMENT_TYPES.some((t) => t.value === type)) return 'Tipo de documento no válido'

  return validateDocument(type, number)
}

/** Formatea para mostrar: `J-12345678-9`. */
export function formatDocument(value: string | null | undefined): string {
  if (!value) return ''
  const { type, number } = parseDocument(value)

  if (type === 'J' && number.length === 9) {
    return `${type}-${number.slice(0, 8)}-${number[8]}`
  }
  return `${type}-${number}`
}

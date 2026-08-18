import {
  Accessibility, Baby, BedDouble, Bell, BusFront, ChefHat, Cigarette, Coffee,
  Croissant, Droplets, Dumbbell, Fan, Flame, Laptop, Microwave, Mountain,
  Palmtree, PawPrint, Refrigerator, ShowerHead, Snowflake, Sparkles,
  SquareParking, Sunrise, Trees, Tv, Umbrella, Utensils, Vault, WashingMachine,
  Waves, Wifi, Wind, Zap,
  type LucideIcon,
} from 'lucide-react'

/**
 * Iconos de amenidades.
 *
 * La base guarda el **nombre** del icono y este mapa lo resuelve. Se valida
 * contra esta lista en lugar de importar dinámicamente: un valor inventado en la
 * base no debe romper la página del alojamiento, y un import dinámico impediría
 * que el empaquetado descarte lo que no se usa.
 */
export const AMENITY_ICONS: Record<string, LucideIcon> = {
  Accessibility, Baby, BedDouble, Bell, BusFront, ChefHat, Cigarette, Coffee,
  Croissant, Droplets, Dumbbell, Fan, Flame, Laptop, Microwave, Mountain,
  Palmtree, PawPrint, Refrigerator, ShowerHead, Snowflake, Sparkles,
  SquareParking, Sunrise, Trees, Tv, Umbrella, Utensils, Vault, WashingMachine,
  Waves, Wifi, Wind, Zap,
}

/** Nombres disponibles, para el selector del panel. */
export const ICON_NAMES = Object.keys(AMENITY_ICONS).sort()

export type Amenity = {
  id: string
  slug: string
  label: string
  icon: string | null
  category: string
  sort_order: number
}

/**
 * Categorías conocidas, en el orden en que se muestran.
 *
 * `otros` recoge lo que el operador cree sin encasillar, y va al final.
 */
export const AMENITY_CATEGORIES: { value: string; label: string }[] = [
  { value: 'conectividad', label: 'Conectividad y entretenimiento' },
  { value: 'climatizacion', label: 'Climatización' },
  { value: 'servicios', label: 'Servicios' },
  { value: 'cocina', label: 'Cocina' },
  { value: 'exteriores', label: 'Exteriores' },
  { value: 'servicios-basicos', label: 'Servicios básicos' },
  { value: 'normas', label: 'Normas' },
  { value: 'otros', label: 'Otros' },
]

export const categoryLabel = (value: string) =>
  AMENITY_CATEGORIES.find((c) => c.value === value)?.label ?? 'Otros'

/** Agrupa por categoría respetando el orden de `AMENITY_CATEGORIES`. */
export function groupByCategory<T extends { category: string; sort_order: number }>(
  items: T[],
): { category: string; label: string; items: T[] }[] {
  return AMENITY_CATEGORIES.map((c) => ({
    category: c.value,
    label: c.label,
    items: items
      .filter((i) => i.category === c.value)
      .sort((a, b) => a.sort_order - b.sort_order),
  })).filter((g) => g.items.length > 0)
}

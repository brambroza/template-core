import { BookOpen, Banknote, FileSignature, Bot, Boxes, Calculator, CalendarDays, Database, Factory, Gauge, Handshake, IdCard, Kanban, LifeBuoy, Package, Receipt, ShieldCheck, ShoppingCart, Stamp, Users, Wallet, Wrench, Zap, type LucideProps } from 'lucide-react';
import type { Icon as IconName } from '@erp/ui-schema';

const MAP: Record<IconName, React.ComponentType<LucideProps>> = {
  users: Users, database: Database, boxes: Boxes, 'shopping-cart': ShoppingCart, receipt: Receipt, factory: Factory,
  wrench: Wrench, calculator: Calculator, zap: Zap, bot: Bot, gauge: Gauge,
  stamp: Stamp, 'id-card': IdCard, wallet: Wallet, package: Package, handshake: Handshake, 'life-buoy': LifeBuoy, kanban: Kanban, 'shield-check': ShieldCheck, calendar: CalendarDays,
  book: BookOpen, banknote: Banknote, 'file-signature': FileSignature,
};

/** Module icon by name; falls back to the module's glyph when no icon is declared. */
export function ModuleIcon({ name, glyph, size = 18 }: { name?: IconName; glyph?: string; size?: number }) {
  const C = name ? MAP[name] : undefined;
  if (C) return <C size={size} strokeWidth={1.8} aria-hidden />;
  return <span aria-hidden style={{ fontWeight: 600, fontSize: size * 0.8 }}>{glyph}</span>;
}

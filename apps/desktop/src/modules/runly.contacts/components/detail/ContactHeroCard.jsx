import { useRef } from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@runly/ui";
import {
  Camera,
  Clock,
  FileText,
  IdCard,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Phone,
  Power,
  PowerOff,
  Ticket,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { TYPE_AVATAR_COLORS, TYPE_LABEL, TYPE_VARIANT } from "../../constants";
import {
  initials,
  mailtoHref,
  primaryChannel,
  relativeTime,
  telHref,
  whatsappHref,
} from "../../lib/contactLinks";

const KPI_ICONS = { "growth.leads": TrendingUp, "dispatch.tickets": Ticket, files: FileText };

function QuickAction({ icon: Icon, label, href, onClick }) {
  const className =
    "flex flex-col items-center justify-center gap-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-medium text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))] sm:flex-row sm:gap-2 sm:rounded-full sm:px-4 sm:text-sm";
  if (href) {
    const external = href.startsWith("http");
    return (
      <a href={href} className={className} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
        <Icon className="h-4 w-4" />
        {label}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function KpiTile({ icon: Icon, label, value, hint }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]">{label}</p>
        <p className="mt-0.5 truncate text-lg font-semibold tabular-nums text-[hsl(var(--foreground))]">{value}</p>
        {hint && <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{hint}</p>}
      </div>
      <Icon className="h-5 w-5 shrink-0 text-[hsl(var(--primary))]" />
    </div>
  );
}

export function ContactHeroCard({
  contact,
  activity,
  canUpdate,
  canDelete,
  onEdit,
  onToggleEnabled,
  onDelete,
  onAvatarSelected,
  avatarBusy,
}) {
  const fileInput = useRef(null);
  const phone = primaryChannel(contact.channels, "phone");
  const email = primaryChannel(contact.channels, "email");
  const colors = TYPE_AVATAR_COLORS[contact.type] ?? TYPE_AVATAR_COLORS.person;
  const summary = activity?.summary ?? [];

  async function copyRfc() {
    try {
      await navigator.clipboard.writeText(contact.taxId);
      toast.success("RFC copiado");
    } catch {
      toast.error("No se pudo copiar el RFC");
    }
  }

  return (
    <Card className="p-5 md:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left lg:flex-1">
          <div className="group relative shrink-0">
            <Avatar className="h-24 w-24 rounded-2xl">
              {contact.avatarUrl && <AvatarImage src={contact.avatarUrl} alt={contact.name} className="object-cover" />}
              <AvatarFallback className={cn("rounded-2xl text-2xl font-semibold", colors.bg, colors.text)}>
                {initials(contact.name)}
              </AvatarFallback>
            </Avatar>
            {canUpdate && (
              <>
                <button
                  type="button"
                  disabled={avatarBusy}
                  onClick={() => fileInput.current?.click()}
                  aria-label="Cambiar foto"
                  className="absolute -bottom-1.5 -right-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--primary))] p-1.5 text-[hsl(var(--primary-foreground))] shadow-md transition-transform hover:scale-105 disabled:opacity-60"
                >
                  <Camera className="h-3.5 w-3.5" />
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) onAvatarSelected?.(file);
                  }}
                />
              </>
            )}
          </div>
          <div className="min-w-0 space-y-2">
            <h1 className="break-words text-2xl font-bold tracking-tight text-[hsl(var(--foreground))] md:text-3xl">
              {contact.name}
            </h1>
            {contact.legalName && contact.legalName !== contact.name && (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">{contact.legalName}</p>
            )}
            <div className="flex flex-wrap justify-center gap-1.5 sm:justify-start">
              <Badge variant={TYPE_VARIANT[contact.type] ?? "outline"}>{TYPE_LABEL[contact.type] ?? contact.type}</Badge>
              <Badge variant={contact.enabled ? "success" : "secondary"}>{contact.enabled ? "Activo" : "Inactivo"}</Badge>
              {(contact.tags ?? []).map((tag) => (
                <Badge key={tag} variant="outline">{tag}</Badge>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:items-end">
          <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap lg:justify-end">
            {phone && <QuickAction icon={Phone} label="Llamar" href={telHref(phone.value, phone.countryCode)} />}
            {phone && <QuickAction icon={MessageCircle} label="WhatsApp" href={whatsappHref(phone.value, phone.countryCode)} />}
            {email && <QuickAction icon={Mail} label="Correo" href={mailtoHref(email.value)} />}
            {contact.taxId && <QuickAction icon={IdCard} label="RFC" onClick={copyRfc} />}
          </div>
          <div className="flex gap-2">
            {canUpdate && (
              <Button onClick={onEdit} className="flex-1 rounded-full sm:flex-none">
                <Pencil className="mr-2 h-4 w-4" />
                Editar contacto
              </Button>
            )}
            {(canUpdate || canDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="rounded-full" aria-label="Más acciones">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canUpdate && (
                    <DropdownMenuItem onSelect={onToggleEnabled}>
                      {contact.enabled ? <PowerOff className="mr-2 h-4 w-4" /> : <Power className="mr-2 h-4 w-4" />}
                      {contact.enabled ? "Desactivar" : "Activar"}
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={onDelete} className="text-[hsl(var(--destructive))]">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Eliminar
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      {(summary.length > 0 || activity?.lastActivityAt) && (
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-[hsl(var(--border))] pt-5 lg:grid-cols-4">
          {summary.map((item) => (
            <KpiTile key={item.key} icon={KPI_ICONS[item.key] ?? FileText} label={item.label} value={item.count} />
          ))}
          <KpiTile
            icon={Clock}
            label="Última actividad"
            value={relativeTime(activity?.lastActivityAt) ?? "Sin actividad"}
          />
        </div>
      )}
    </Card>
  );
}

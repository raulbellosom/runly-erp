import { Badge, CopyableValue, EmptyState, MarkdownViewer, SectionCard, cn } from "@runly/ui";
import {
  REGIMEN_FISCAL,
  USO_CFDI,
  formatCatalogEntry,
  rfcPersonType,
} from "@runly/validators";
import { Building2, ExternalLink, Landmark, Mail, MapPin, MessageCircle, Phone, StickyNote, Users } from "lucide-react";
import { TYPE_LABEL } from "../../constants";
import {
  ADDRESS_KIND_LABELS,
  CHANNEL_LABELS,
  formatAddressLines,
  initials,
  mailtoHref,
  mapsHref,
  telHref,
  whatsappHref,
} from "../../lib/contactLinks";

const PERSON_TYPE_LABEL = { moral: "Persona moral", fisica: "Persona física" };

function CardTitle({ icon: Icon, children }) {
  return (
    <span className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-[hsl(var(--primary))]" />
      {children}
    </span>
  );
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : null;
}

export function ChannelList({ channels = [] }) {
  if (!channels.length) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">Sin medios de contacto.</p>;
  }
  return (
    <ul className="space-y-2">
      {channels.map((channel, index) => {
        const isPhone = channel.kind === "phone";
        const Icon = isPhone ? Phone : Mail;
        const href = isPhone ? telHref(channel.value, channel.countryCode) : mailtoHref(channel.value);
        return (
          <li
            key={channel.id ?? `${channel.kind}-${index}`}
            className="flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 px-3 py-2.5"
          >
            <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {CHANNEL_LABELS[channel.label] ?? "Otro"}
                {channel.isPrimary && " · Principal"}
              </p>
              <p className="truncate text-sm font-medium tabular-nums">
                {isPhone && channel.countryCode ? `${channel.countryCode} ` : ""}
                {channel.value}
              </p>
            </div>
            {isPhone && (
              <a
                href={whatsappHref(channel.value, channel.countryCode)}
                target="_blank"
                rel="noreferrer"
                aria-label="Abrir WhatsApp"
                className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]"
              >
                <MessageCircle className="h-4 w-4" />
              </a>
            )}
            {href && (
              <a
                href={href}
                aria-label={isPhone ? "Llamar" : "Enviar correo"}
                className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]"
              >
                <Icon className="h-4 w-4" />
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function PeopleList({ persons = [], emptyText = "Sin personas registradas." }) {
  if (!persons.length) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">{emptyText}</p>;
  }
  return (
    <ul className="space-y-2">
      {persons.map((person) => (
        <li key={person.id} className="flex items-start gap-3 rounded-xl border border-[hsl(var(--border))] px-3 py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))]/10 text-xs font-semibold text-[hsl(var(--primary))]">
            {initials(person.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="truncate text-sm font-semibold">{person.name}</p>
              {person.isPrimary && <Badge variant="glass">Principal</Badge>}
            </div>
            {person.role && <p className="text-xs text-[hsl(var(--muted-foreground))]">{person.role}</p>}
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {person.phone && (
                <a href={telHref(person.phone)} className="inline-flex items-center gap-1 hover:text-[hsl(var(--primary))]">
                  <Phone className="h-3 w-3" /> {person.phone}
                </a>
              )}
              {person.email && (
                <a href={mailtoHref(person.email)} className="inline-flex min-w-0 items-center gap-1 truncate hover:text-[hsl(var(--primary))]">
                  <Mail className="h-3 w-3" /> {person.email}
                </a>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AddressCard({ address }) {
  const lines = formatAddressLines(address);
  const href = mapsHref(address);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={address.kind === "fiscal" ? "glass" : "outline"}>{ADDRESS_KIND_LABELS[address.kind] ?? "Otra"}</Badge>
        {address.label && <span className="text-xs text-[hsl(var(--muted-foreground))]">{address.label}</span>}
        {address.isDefault && <span className="text-xs text-[hsl(var(--muted-foreground))]">· Predeterminada</span>}
      </div>
      <div className="text-sm leading-relaxed">
        {lines.map((line) => <p key={line}>{line}</p>)}
      </div>
      {href && (
        <a href={href} target="_blank" rel="noreferrer" className="mt-auto inline-flex items-center gap-1 self-start text-xs font-medium text-[hsl(var(--primary))] hover:underline">
          <ExternalLink className="h-3 w-3" /> Ver en mapa
        </a>
      )}
    </div>
  );
}

export function ContactSummaryTab({ contact }) {
  const personType = rfcPersonType(contact.taxId);

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        <SectionCard title={<CardTitle icon={Building2}>Datos generales</CardTitle>}>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <CopyableValue label="Tipo" value={TYPE_LABEL[contact.type] ?? contact.type} copyable={false} />
            <CopyableValue label="Giro" value={contact.industry} copyable={false} />
            <CopyableValue
              label="Sitio web"
              value={contact.website}
              display={
                contact.website && (
                  <a href={contact.website} target="_blank" rel="noreferrer" className="text-[hsl(var(--primary))] hover:underline">
                    {contact.website.replace(/^https?:\/\//, "")}
                  </a>
                )
              }
            />
            <CopyableValue label="Razón social" value={contact.legalName} />
          </dl>
        </SectionCard>

        <SectionCard
          title={<CardTitle icon={Landmark}>Datos fiscales</CardTitle>}
          action={personType && <Badge variant="outline">{PERSON_TYPE_LABEL[personType]}</Badge>}
        >
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <CopyableValue label="RFC" value={contact.taxId} mono />
            <CopyableValue label="Régimen fiscal" value={contact.taxRegime && formatCatalogEntry(REGIMEN_FISCAL, contact.taxRegime)} />
            <CopyableValue label="Código postal fiscal" value={contact.fiscalPostalCode} mono />
            <CopyableValue label="Uso de CFDI" value={contact.cfdiUse && formatCatalogEntry(USO_CFDI, contact.cfdiUse)} />
          </dl>
        </SectionCard>

        <SectionCard title={<CardTitle icon={MapPin}>Direcciones</CardTitle>}>
          {contact.addresses?.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {contact.addresses.map((address) => <AddressCard key={address.id} address={address} />)}
            </div>
          ) : (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Sin direcciones registradas.</p>
          )}
        </SectionCard>

        <SectionCard title={<CardTitle icon={StickyNote}>Notas</CardTitle>}>
          <MarkdownViewer value={contact.notesMarkdown} emptyText="Sin notas." />
        </SectionCard>
      </div>

      <div className="space-y-5">
        <SectionCard title={<CardTitle icon={Phone}>Medios de contacto</CardTitle>}>
          <ChannelList channels={contact.channels} />
        </SectionCard>
        {contact.type !== "person" && (
          <SectionCard title={<CardTitle icon={Users}>Personas clave</CardTitle>}>
            <PeopleList persons={contact.persons} />
          </SectionCard>
        )}
        <p className={cn("px-1 text-xs text-[hsl(var(--muted-foreground))]")}>
          Creado {formatDate(contact.createdAt)} · Actualizado {formatDate(contact.updatedAt)}
        </p>
      </div>
    </div>
  );
}

export function ContactPeopleTab({ contact }) {
  if (!contact.persons?.length) {
    return <EmptyState title="Sin personas clave" description="Agrega personas de contacto desde Editar contacto." />;
  }
  return <PeopleList persons={contact.persons} />;
}

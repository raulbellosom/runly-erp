import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Switch,
} from "@runly/ui";
import { BellRing, CalendarClock, CheckSquare2, Globe2, MessageCircle, PhoneCall, ShieldAlert, Users } from "lucide-react";
import { toast } from "sonner";
import { getDefaultNotificationPreference } from '@runly/core';
import { useAuth } from "../../auth/AuthProvider";
import { runly } from "../../lib/runly";
import {
  getCurrentWebPushSubscription,
  getStoredWebPushSubscriptionId,
  isWebPushSupported,
  subscribeCurrentDeviceToWebPush,
  syncCurrentDeviceWebPushSubscription,
  unsubscribeCurrentDeviceFromWebPush,
} from "../../lib/webPush";

const EVENT_CATALOG = [
  { eventType: 'calendar.event.invite', title: 'Invitación a evento', description: 'Cuando te invitan a un evento.', icon: CalendarClock },
  { eventType: 'calendar.event.reschedule', title: 'Evento reprogramado', description: 'Cuando cambia la fecha de un evento al que asistes.', icon: CalendarClock },
  { eventType: 'calendar.event.cancel', title: 'Evento cancelado', description: 'Cuando cancelan un evento al que asistes.', icon: CalendarClock },
  { eventType: 'growth.lead.created', title: 'Nuevo lead asignado', description: 'Cuando se crea un lead a tu cargo.', icon: Users },
  { eventType: 'growth.lead.assigned', title: 'Asignación de lead', description: 'Cuando te asignan un lead existente.', icon: Users },
  { eventType: 'ledger.account_invite', title: 'Cuenta compartida', description: 'Cuando te comparten una cuenta.', icon: Users },
  { eventType: 'ledger.group_invite', title: 'Grupo de cuentas compartido', description: 'Cuando te agregan a un grupo de cuentas.', icon: Users },
  { eventType: 'ledger.access_revoked', title: 'Acceso a cuentas retirado', description: 'Cuando retiran tu acceso a una cuenta o grupo.', icon: ShieldAlert },
  { eventType: 'pfm.budget.threshold', title: 'Presupuesto próximo al límite', description: 'Cuando tu presupuesto alcanza el umbral de alerta.', icon: ShieldAlert },
  { eventType: 'pfm.budget.overage', title: 'Presupuesto excedido', description: 'Cuando tus gastos superan el presupuesto.', icon: ShieldAlert },
  { eventType: 'projects.task.reaction', title: 'Reacción en tarea', description: 'Cuando reaccionan a tu comentario en una tarea.', icon: CheckSquare2 },
  { eventType: 'inventory.item.reaction', title: 'Reacción en inventario', description: 'Cuando reaccionan a tu comentario en inventario.', icon: CheckSquare2 },
  // runly.chat
  { eventType: 'chat.member.added', title: 'Invitación a un chat', description: 'Cuando te agregan a un canal o grupo.', icon: Users },
  { eventType: 'chat.mention.new', title: 'Mención en chat', description: 'Cuando te mencionan en una conversación.', icon: MessageCircle },
  { eventType: 'chat.thread.reply', title: 'Respuesta en un hilo', description: 'Cuando responden en un hilo en el que participas.', icon: MessageCircle },
  { eventType: 'notes.note.shared', title: 'Nota compartida', description: 'Cuando comparten una nota contigo.', icon: Users },
  { eventType: 'inventory.item.mention', title: 'Mención en inventario', description: 'Cuando te mencionan en un comentario de inventario.', icon: CheckSquare2 },
  {
    eventType: "chat.message.new",
    title: "Mensaje de chat",
    description:
      "Aviso por cada mensaje directo o de grupo. El correo solo se envia cuando llevas un rato sin abrir la conversacion, no en cada mensaje.",
    icon: MessageCircle,
  },
  {
    eventType: "chat.call.incoming",
    title: "Llamada entrante",
    description: "Cuando alguien te llama o inicia una videollamada.",
    icon: PhoneCall,
  },
  // runly.projects
  {
    eventType: "projects.member.added",
    title: "Nuevo miembro en proyecto",
    description: "Cuando te agregan como miembro a un proyecto.",
    icon: Users,
  },
  {
    eventType: "projects.task.assigned",
    title: "Tarea asignada",
    description: "Cuando te asignan una tarea.",
    icon: CheckSquare2,
  },
  {
    eventType: "projects.task.unassigned",
    title: "Removido de tarea",
    description: "Cuando te quitan de una tarea asignada.",
    icon: CheckSquare2,
  },
  {
    eventType: "projects.task.comment",
    title: "Comentario en tarea",
    description: "Nuevo comentario en una tarea asignada a ti.",
    icon: CheckSquare2,
  },
  {
    eventType: "projects.task.mention",
    title: "Mencion en comentario",
    description: "Alguien te menciono con @ en un comentario.",
    icon: CheckSquare2,
  },
  {
    eventType: "projects.task.due_soon",
    title: "Tarea por vencer",
    description: "Una tarea tuya vence en menos de 24 horas.",
    icon: CheckSquare2,
  },
  {
    eventType: "projects.task.status_changed",
    title: "Cambio de estado en tarea",
    description: "El estado de una tarea asignada a ti cambio.",
    icon: CheckSquare2,
  },
  // runly.calendar
  {
    eventType: "calendar.event.reminder",
    title: "Recordatorio de calendario",
    description: "Alerta cuando un evento esta por comenzar.",
    icon: CalendarClock,
  },
  // runly.website
  {
    eventType: "website.sale.confirmed",
    title: "Venta confirmada",
    description: "Notifica nuevas ventas confirmadas en website.",
    icon: Globe2,
  },
  {
    eventType: "website.payment.failed",
    title: "Pago fallido",
    description: "Avisa si una transaccion falla en checkout.",
    icon: Globe2,
  },
  // sistema
  {
    eventType: "system.alert",
    title: "Alerta de sistema",
    description: "Eventos criticos de operacion o integraciones.",
    icon: ShieldAlert,
  },
];

function PreferencesSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="rounded-2xl border border-[hsl(var(--border))] p-4 space-y-3"
        >
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-3.5 w-3/4" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-10 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function NotificationSettingsScreen() {
  const queryClient = useQueryClient();
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const canRead = Boolean(
    userProfile?.isAdmin ||
      (userProfile?.permissions ?? []).includes("notifications.read"),
  );

  const [pendingKey, setPendingKey] = useState(null);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState("default");
  const [pushSubscriptionId, setPushSubscriptionId] = useState(null);
  const [hasBrowserPushSubscription, setHasBrowserPushSubscription] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  const {
    data: preferencesData,
    isError: isPreferencesError,
    isLoading: isPreferencesLoading,
    refetch: refetchPreferences,
  } = useQuery({
    queryKey: ["notification-preferences", token],
    queryFn: () => runly.notifications.listPreferences(token),
    enabled: Boolean(token) && canRead,
  });

  // Checks whether the server has VAPID keys configured.
  // VAPID keys are managed from Atlas Core → Settings → Web Push (not env vars).
  // The endpoint returns 409 with code "web_push_not_configured" when keys are absent.
  const {
    data: vapidConfig,
    isError: vapidError,
    error: vapidErr,
    isLoading: vapidLoading,
  } = useQuery({
    queryKey: ["notifications-webpush-public-key", token],
    queryFn: () => runly.notifications.getWebPushPublicKey(token),
    enabled: Boolean(token) && canRead,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

  const vapidNotConfigured = vapidError && vapidErr?.status === 409;
  const vapidConfigured = Boolean(vapidConfig?.data?.publicKey);

  const upsertMutation = useMutation({
    mutationFn: (payload) => runly.notifications.upsertPreference(token, payload),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["notification-preferences", token],
      }),
    onError: () => toast.error("No se pudo guardar la preferencia"),
    onSettled: () => setPendingKey(null),
  });

  const preferencesMap = useMemo(() => {
    const rows = preferencesData?.data ?? [];
    return new Map(rows.map((row) => [row.eventType, row]));
  }, [preferencesData]);

  const catalogRows = useMemo(() => {
    const known = new Set(EVENT_CATALOG.map((item) => item.eventType));
    const extras = [...preferencesMap.keys()]
      .filter((eventType) => !known.has(eventType))
      .map((eventType) => ({
        eventType,
        title: eventType,
        description: "Evento registrado por un modulo.",
        icon: BellRing,
      }));
    return [...EVENT_CATALOG, ...extras];
  }, [preferencesMap]);

  useEffect(() => {
    let cancelled = false;

    async function loadPushState() {
      const supported = isWebPushSupported();
      if (cancelled) return;
      setPushSupported(supported);
      if (!supported) return;

      setPushPermission(Notification.permission);

      const subscription = await getCurrentWebPushSubscription().catch(() => null);
      if (cancelled) return;

      setHasBrowserPushSubscription(Boolean(subscription));
      setPushSubscriptionId(getStoredWebPushSubscriptionId());

      if (!subscription || !token) return;

      const response = await syncCurrentDeviceWebPushSubscription({
        token,
        deviceLabel: "Dispositivo web",
      }).catch(() => null);
      if (cancelled) return;

      setPushSubscriptionId(
        response?.data?.id ?? getStoredWebPushSubscriptionId() ?? null,
      );
    }

    loadPushState();

    return () => {
      cancelled = true;
    };
  }, [token]);

  function getPreference(eventType) {
    return {
      ...getDefaultNotificationPreference(eventType),
      ...(preferencesMap.get(eventType) ?? {}),
    };
  }

  function updatePreference(eventType, patch) {
    const current = getPreference(eventType);
    setPendingKey(`${eventType}:${Object.keys(patch)[0]}`);
    upsertMutation.mutate({
      eventType,
      inAppEnabled: current.inAppEnabled,
      emailEnabled: current.emailEnabled,
      pushEnabled: current.pushEnabled,
      ...patch,
    });
  }

  async function handleSubscribeCurrentDevice() {
    if (!token) return;
    setPushBusy(true);
    try {
      const response = await subscribeCurrentDeviceToWebPush({
        token,
        deviceLabel: "Dispositivo web",
      });
      setPushPermission(Notification.permission);
      setHasBrowserPushSubscription(true);
      setPushSubscriptionId(response?.data?.id ?? getStoredWebPushSubscriptionId());
      toast.success("Push web activado en este dispositivo.");
    } catch (err) {
      toast.error(err?.message ?? "No se pudo activar push web.");
    } finally {
      setPushBusy(false);
    }
  }

  async function handleUnsubscribeCurrentDevice() {
    if (!token) return;
    setPushBusy(true);
    try {
      await unsubscribeCurrentDeviceFromWebPush({ token });
      setHasBrowserPushSubscription(false);
      setPushSubscriptionId(null);
      setPushPermission(
        typeof Notification === "undefined" ? "default" : Notification.permission,
      );
      toast.success("Push web desactivado en este dispositivo.");
    } catch (err) {
      toast.error(err?.message ?? "No se pudo desactivar push web.");
    } finally {
      setPushBusy(false);
    }
  }

  if (!canRead) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <PageHeader
          eyebrow="Runly Notifications"
          title="Configuracion de notificaciones"
          description="Define por que canales quieres recibir alertas."
        />
        <ErrorState message="No tienes permisos para configurar notificaciones." />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        eyebrow="Runly Notifications"
        title="Configuracion"
        description="Controla que eventos reciben notificacion en plataforma, correo y push."
      />

      <Card>
        <CardHeader>
          <CardTitle>Push web en este dispositivo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Activa notificaciones para recibir alertas en segundo plano cuando uses la PWA.
          </p>
          {vapidLoading ? (
            <Skeleton className="h-10 w-full rounded-lg" />
          ) : vapidNotConfigured ? (
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">
              Push no disponible en este servidor — contacta al administrador para configurar VAPID.
            </div>
          ) : !pushSupported ? (
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">
              Este navegador no soporta Web Push.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">
                Estado del permiso:{" "}
                <span className="font-medium text-[hsl(var(--foreground))]">
                  {pushPermission === "granted"
                    ? "Permitido"
                    : pushPermission === "denied"
                      ? "Bloqueado"
                    : "Pendiente"}
                </span>
                <span className="mx-2">·</span>
                Suscripcion del navegador:{" "}
                <span className="font-medium text-[hsl(var(--foreground))]">
                  {hasBrowserPushSubscription ? "Activa" : "No activa"}
                </span>
              </div>
              {pushPermission === "granted" && !hasBrowserPushSubscription ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                  Este Chrome tiene permiso, pero no una suscripcion push activa. Vuelve a suscribirte en este dispositivo.
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={handleSubscribeCurrentDevice}
                  disabled={pushBusy || pushPermission === "denied"}
                >
                  {pushBusy ? "Procesando..." : "Suscribirme a push"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleUnsubscribeCurrentDevice}
                  disabled={
                    pushBusy || (!hasBrowserPushSubscription && !pushSubscriptionId)
                  }
                >
                  {pushBusy ? "Procesando..." : "Desuscribirme"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferencias por evento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isPreferencesLoading ? (
            <PreferencesSkeleton />
          ) : isPreferencesError ? (
            <ErrorState
              title="No se pudieron cargar las preferencias"
              onRetry={() => refetchPreferences()}
            />
          ) : catalogRows.length === 0 ? (
            <EmptyState
              icon={BellRing}
              title="Sin eventos"
              description="Aun no hay eventos configurables."
            />
          ) : (
            catalogRows.map((row) => {
              const pref = getPreference(row.eventType);
              const Icon = row.icon ?? BellRing;
              return (
                <div
                  key={row.eventType}
                  className="rounded-2xl border border-[hsl(var(--border))] p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-xl bg-[hsl(var(--muted))] flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                        {row.title}
                      </p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                        {row.description}
                      </p>
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1 font-mono">
                        {row.eventType}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 flex items-center justify-between">
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                        En plataforma
                      </span>
                      <Switch
                        checked={Boolean(pref.inAppEnabled)}
                        disabled={pendingKey === `${row.eventType}:inAppEnabled`}
                        onCheckedChange={(checked) =>
                          updatePreference(row.eventType, { inAppEnabled: checked })
                        }
                      />
                    </div>
                    <div className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 flex items-center justify-between">
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                        Correo
                      </span>
                      <Switch
                        checked={Boolean(pref.emailEnabled)}
                        disabled={pendingKey === `${row.eventType}:emailEnabled`}
                        onCheckedChange={(checked) =>
                          updatePreference(row.eventType, { emailEnabled: checked })
                        }
                      />
                    </div>
                    <div className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 flex items-center justify-between">
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                        Push web
                      </span>
                      <Switch
                        checked={Boolean(pref.pushEnabled)}
                        disabled={pendingKey === `${row.eventType}:pushEnabled`}
                        onCheckedChange={(checked) =>
                          updatePreference(row.eventType, { pushEnabled: checked })
                        }
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

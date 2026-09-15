import { useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityTimeline,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ComboboxField,
  ConfirmDialog,
  DatePickerField,
  DistDropZone,
  ErrorState,
  MarkdownField,
  PageHeader,
  PhoneField,
  SelectField,
  Skeleton,
  SwitchField,
  TextField,
} from "@runly/ui";
import { AdvancedFileViewer } from "@runly/ui";
import UserPermissionGrantsCard from "../components/UserPermissionGrantsCard";
import {
  ArrowLeft,
  CalendarDays,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Shield,
  Trash2,
  UserRound,
  VenusAndMars,
  ZoomIn,
} from "lucide-react";
import { Country, State, City } from "country-state-city";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";

const NO_ROLE_VALUE = "__none__";

function parseUserRoute(pathname) {
  const chunks = pathname.split("/").filter(Boolean);
  const isEditRoute = chunks[chunks.length - 1] === "edit";
  const userId = isEditRoute
    ? (chunks[chunks.length - 2] ?? "")
    : (chunks[chunks.length - 1] ?? "");
  return { userId, isEditRoute };
}

export default function UserEditorScreen() {
  const { session, userProfile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const token = session?.access_token;
  const { userId, isEditRoute } = parseUserRoute(location.pathname);
  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (key) =>
    Boolean(userProfile?.isAdmin || permissions.includes(key));
  const canReadUsers = hasPermission("identity.users.read");
  const canManageUsers = hasPermission("identity.users.update");
  const canDeleteUsers = hasPermission("identity.users.delete");
  const canReadRoles = hasPermission("identity.roles.read");
  const canManageGrants =
    hasPermission("identity.permissions.update") &&
    hasPermission("identity.users.update");
  const queryClient = useQueryClient();
  const isSelf = userId === userProfile?.id;
  const canEditForm = canManageUsers && isEditRoute;
  const canChangeAvatar = canManageUsers;
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const usersQuery = useQuery({
    queryKey: ["identity-users"],
    queryFn: () => runly.identity.listUsers(token),
    enabled: Boolean(token) && canReadUsers,
  });
  const rolesQuery = useQuery({
    queryKey: ["identity-roles"],
    queryFn: () => runly.identity.listRoles(token),
    enabled: Boolean(token) && canReadRoles,
  });

  const user = useMemo(
    () =>
      (usersQuery.data?.data ?? []).find((item) => item.id === userId) ?? null,
    [usersQuery.data, userId],
  );
  const membership = user?.memberships?.[0] ?? null;

  const resolveUserAvatarSignedUrl = useCallback(
    async () => {
      const res = await runly.identity.getUserAvatarSignedUrl(user?.id, token, { variant: "full" });
      return res?.data?.signedUrl ?? null;
    },
    [user?.id, token],
  );

  const [draft, setDraft] = useState(null);

  const updateUserMutation = useMutation({
    mutationFn: (payload) => runly.identity.updateUser(userId, payload, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["identity-users"] });
      setDraft(null);
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: () => runly.identity.deleteUser(userId, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["identity-users"] });
      toast.success("Usuario eliminado");
      navigate("/app/m/runly.identity/identity/users");
    },
    onError: (err) => {
      try {
        const msg = JSON.parse(err?.message || "{}").error;
        toast.error(msg || "No se pudo eliminar el usuario");
      } catch {
        toast.error("No se pudo eliminar el usuario");
      }
    },
  });

  const avatarMutation = useMutation({
    mutationFn: (file) => runly.identity.uploadUserAvatar(userId, file, token),
    onMutate: () => toast.loading("Subiendo foto de perfil..."),
    onSuccess: async (_data, _vars, toastId) => {
      await queryClient.invalidateQueries({ queryKey: ["identity-users"] });
      if (isSelf) {
        await queryClient.invalidateQueries({ queryKey: ["profile-me"] });
        refreshProfile(session);
      }
      toast.success("Foto de perfil actualizada", { id: toastId });
    },
    onError: (_err, _vars, toastId) =>
      toast.error("No se pudo actualizar la foto de perfil", { id: toastId }),
  });

  const roleOptions = useMemo(
    () => [
      { value: NO_ROLE_VALUE, label: "Sin rol" },
      ...(rolesQuery.data?.data ?? []).map((role) => ({
        value: role.id,
        label: role.name,
      })),
    ],
    [rolesQuery.data],
  );

  const effective = {
    firstName: draft?.firstName ?? user?.firstName ?? "",
    lastName: draft?.lastName ?? user?.lastName ?? "",
    email: draft?.email ?? user?.email ?? "",
    enabled: draft?.enabled ?? user?.enabled ?? false,
    roleId: draft?.roleId ?? membership?.roleId ?? NO_ROLE_VALUE,
    phone: draft?.phone ?? user?.phone ?? "",
    birthDate:
      draft?.birthDate ??
      (user?.birthDate
        ? // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date calendar value
          new Date(user.birthDate).toISOString().slice(0, 10)
        : ""),
    gender: draft?.gender ?? user?.gender ?? "",
    bio: draft?.bio ?? user?.bio ?? "",
    country: draft?.country ?? user?.country ?? "",
    state: draft?.state ?? user?.state ?? "",
    city: draft?.city ?? user?.city ?? "",
    colony: draft?.colony ?? user?.colony ?? "",
    street: draft?.street ?? user?.street ?? "",
    extNumber: draft?.extNumber ?? user?.extNumber ?? "",
    intNumber: draft?.intNumber ?? user?.intNumber ?? "",
    postalCode: draft?.postalCode ?? user?.postalCode ?? "",
  };

  const countryOptions = useMemo(
    () =>
      Country.getAllCountries().map((c) => ({
        value: c.isoCode,
        label: c.name,
      })),
    [],
  );

  const stateOptions = useMemo(
    () =>
      effective.country
        ? State.getStatesOfCountry(effective.country).map((s) => ({
            value: s.isoCode,
            label: s.name,
          }))
        : [],
    [effective.country],
  );

  const cityOptions = useMemo(
    () =>
      effective.country && effective.state
        ? City.getCitiesOfState(effective.country, effective.state).map(
            (c) => ({ value: c.name, label: c.name }),
          )
        : [],
    [effective.country, effective.state],
  );

  function saveChanges() {
    if (!user) return;
    const payload = {
      firstName: effective.firstName,
      lastName: effective.lastName,
      enabled: effective.enabled,
      email: effective.email,
      phone: effective.phone || null,
      birthDate: effective.birthDate || null,
      gender: effective.gender || null,
      bio: effective.bio || null,
      country: effective.country || null,
      state: effective.state || null,
      city: effective.city || null,
      colony: effective.colony || null,
      street: effective.street || null,
      extNumber: effective.extNumber || null,
      intNumber: effective.intNumber || null,
      postalCode: effective.postalCode || null,
    };
    if (membership) {
      payload.membershipId = membership.id;
      payload.roleId =
        effective.roleId === NO_ROLE_VALUE ? null : effective.roleId;
    }
    updateUserMutation.mutate(payload, {
      onSuccess: () => toast.success("Usuario actualizado"),
      onError: () => toast.error("No se pudo actualizar el usuario"),
    });
  }

  function handleAvatarFile(file) {
    if (!file || !canChangeAvatar) return;
    avatarMutation.mutate(file);
  }

  return (
    <div className={`p-4 md:p-6 space-y-6${draft ? " pb-24" : ""}`}>
      <PageHeader
        eyebrow="Runly Identity"
        title={isEditRoute ? "Editar usuario" : "Detalle de usuario"}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate("/app/m/runly.identity/identity/users")}
            >
              <ArrowLeft className="h-4 w-4" />
              Volver a usuarios
            </Button>
            {canManageUsers &&
              user &&
              (isEditRoute ? (
                <Button
                  variant="outline"
                  onClick={() => navigate(`/app/m/runly.identity/identity/users/${user.id}`)}
                >
                  Ver detalle
                </Button>
              ) : (
                <Button
                  onClick={() => navigate(`/app/m/runly.identity/identity/users/${user.id}/edit`)}
                >
                  <Pencil className="h-4 w-4" />
                  Editar
                </Button>
              ))}
            {canDeleteUsers && user && !isSelf && (
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4" />
                Eliminar usuario
              </Button>
            )}
          </div>
        }
      />

      {!canReadUsers && (
        <ErrorState message="No tienes permisos para consultar usuarios." />
      )}

      {canReadUsers && (usersQuery.isLoading || rolesQuery.isLoading) && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <Skeleton className="h-8 w-72 rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </CardContent>
        </Card>
      )}

      {canReadUsers && usersQuery.isError && (
        <ErrorState title="Error al cargar usuario" message="No se pudo cargar la informacion del usuario." onRetry={() => usersQuery.refetch()} />
      )}

      {canReadUsers && !usersQuery.isLoading && !usersQuery.isError && !user && (
        <ErrorState message="Usuario no encontrado." />
      )}

      {canReadUsers && user && !rolesQuery.isLoading && (
        <Card>
          <CardHeader>
            <CardTitle>{user.displayName || "Usuario"}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <div className="flex flex-col gap-4 rounded-xl border border-[hsl(var(--border))] p-4 sm:flex-row sm:items-center">
              <button
                type="button"
                className="group relative w-fit rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                disabled={!user?.avatarFileId}
                onClick={() => user?.avatarFileId && setImageViewerOpen(true)}
              >
                <Avatar className="h-20 w-20">
                  <AvatarImage
                    src={user?.avatarUrl ?? ""}
                    alt={user?.displayName || "Usuario"}
                  />
                  <AvatarFallback className="bg-[hsl(var(--muted))]">
                    <UserRound className="h-9 w-9 text-[hsl(var(--muted-foreground))]" />
                  </AvatarFallback>
                </Avatar>
                {user?.avatarUrl ? (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/0 transition-colors group-hover:bg-black/30">
                    <ZoomIn className="h-5 w-5 text-white opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                ) : null}
              </button>
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-sm font-medium">
                  {user?.displayName || "Usuario"}
                </p>
                {canChangeAvatar && (
                  <DistDropZone
                    variant="compact"
                    accept="image/*"
                    maxSizeMB={10}
                    fullScreenOverlay
                    overlayLabel="Suelta tu foto aqui"
                    overlayHint="JPG, PNG o WebP · maximo 10 MB"
                    onFile={handleAvatarFile}
                    isUploading={avatarMutation.isPending}
                    emptyLabel="Arrastra o haz clic para cambiar foto"
                    emptyHint="JPG, PNG o WebP · maximo 10 MB"
                  />
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant={effective.enabled ? "success" : "secondary"}>
                {effective.enabled ? "Activo" : "Inactivo"}
              </Badge>
              {membership?.companyName && (
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  Empresa: {membership.companyName}
                </span>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <TextField
                icon={UserRound}
                label="Nombre"
                value={effective.firstName}
                disabled={!canEditForm}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...(prev ?? {}),
                    firstName: e.target.value,
                  }))
                }
              />
              <TextField
                icon={UserRound}
                label="Apellidos"
                value={effective.lastName}
                disabled={!canEditForm}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...(prev ?? {}),
                    lastName: e.target.value,
                  }))
                }
              />
              <TextField
                icon={Mail}
                label="Correo"
                value={effective.email}
                disabled={!canEditForm}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...(prev ?? {}),
                    email: e.target.value,
                  }))
                }
              />
              <SelectField
                icon={Shield}
                label="Rol"
                value={effective.roleId}
                options={roleOptions}
                placeholder="Seleccionar rol"
                onValueChange={(value) =>
                  setDraft((prev) => ({ ...(prev ?? {}), roleId: value }))
                }
                disabled={!canEditForm || !canReadRoles || !membership}
              />
            </div>

            <SwitchField
              id="user-enabled"
              label="Usuario activo"
              checked={effective.enabled}
              disabled={!canEditForm}
              onChange={(checked) =>
                setDraft((prev) => ({ ...(prev ?? {}), enabled: checked }))
              }
            />

            {!canEditForm && (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Modo lectura: necesitas permiso identity.users.update para
                editar.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {canReadUsers && user && !rolesQuery.isLoading && (
        <Card>
          <CardHeader>
            <CardTitle>Datos personales</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <PhoneField
                label="Teléfono"
                icon={Phone}
                value={effective.phone}
                disabled={!canEditForm}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...(prev ?? {}),
                    phone: e.target.value,
                  }))
                }
              />
              <DatePickerField
                label="Fecha de nacimiento"
                value={effective.birthDate}
                disabled={!canEditForm}
                onChange={(val) =>
                  setDraft((prev) => ({
                    ...(prev ?? {}),
                    birthDate: val ?? "",
                  }))
                }
              />
              <SelectField
                icon={VenusAndMars}
                label="Sexo"
                value={effective.gender}
                placeholder="Seleccionar"
                disabled={!canEditForm}
                options={[
                  { value: "masculino", label: "Masculino" },
                  { value: "femenino", label: "Femenino" },
                  { value: "no_binario", label: "No binario" },
                  { value: "prefiero_no_decir", label: "Prefiero no decir" },
                ]}
                onValueChange={(value) =>
                  setDraft((prev) => ({ ...(prev ?? {}), gender: value }))
                }
              />
            </div>

            <MarkdownField
              label="Biografía"
              value={effective.bio}
              maxLength={500}
              placeholder="Escribe la biografía aquí..."
              disabled={!canEditForm}
              onChange={(e) =>
                setDraft((prev) => ({ ...(prev ?? {}), bio: e.target.value }))
              }
            />

            <p className="text-[13px] font-medium text-[hsl(var(--foreground))]/80 flex items-center gap-1.5 pt-2">
              <MapPin className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
              Dirección
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              <ComboboxField
                label="País"
                options={countryOptions}
                value={effective.country}
                disabled={!canEditForm}
                onChange={(val) =>
                  setDraft((prev) => ({
                    ...(prev ?? {}),
                    country: val,
                    state: "",
                    city: "",
                    colony: "",
                  }))
                }
                placeholder="Seleccionar país..."
                searchPlaceholder="Buscar país..."
              />
              {stateOptions.length > 0 ? (
                <ComboboxField
                  label="Estado / Provincia"
                  options={stateOptions}
                  value={effective.state}
                  disabled={!canEditForm}
                  onChange={(val) =>
                    setDraft((prev) => ({
                      ...(prev ?? {}),
                      state: val,
                      city: "",
                      colony: "",
                    }))
                  }
                  placeholder="Seleccionar estado..."
                  searchPlaceholder="Buscar estado..."
                />
              ) : (
                <TextField
                  label="Estado / Provincia"
                  icon={MapPin}
                  value={effective.state}
                  disabled={!canEditForm}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...(prev ?? {}),
                      state: e.target.value,
                    }))
                  }
                />
              )}
              {effective.country && cityOptions.length > 0 ? (
                <ComboboxField
                  label="Ciudad / Municipio"
                  options={cityOptions}
                  value={effective.city}
                  disabled={!canEditForm}
                  onChange={(val) =>
                    setDraft((prev) => ({ ...(prev ?? {}), city: val }))
                  }
                  placeholder="Seleccionar ciudad..."
                  searchPlaceholder="Buscar ciudad..."
                  minSearchLength={2}
                />
              ) : (
                <TextField
                  label="Ciudad / Municipio"
                  icon={MapPin}
                  value={effective.city}
                  disabled={!canEditForm}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...(prev ?? {}),
                      city: e.target.value,
                    }))
                  }
                />
              )}
              <TextField
                label="Colonia / Fraccionamiento"
                icon={MapPin}
                value={effective.colony}
                disabled={!canEditForm}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...(prev ?? {}),
                    colony: e.target.value,
                  }))
                }
              />
              <TextField
                label="Calle"
                icon={MapPin}
                value={effective.street}
                disabled={!canEditForm}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...(prev ?? {}),
                    street: e.target.value,
                  }))
                }
              />
              <TextField
                label="Número exterior"
                value={effective.extNumber}
                disabled={!canEditForm}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...(prev ?? {}),
                    extNumber: e.target.value,
                  }))
                }
              />
              <TextField
                label="Número interior"
                value={effective.intNumber}
                disabled={!canEditForm}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...(prev ?? {}),
                    intNumber: e.target.value,
                  }))
                }
              />
              <TextField
                label="Código postal"
                value={effective.postalCode}
                disabled={!canEditForm}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...(prev ?? {}),
                    postalCode: e.target.value,
                  }))
                }
              />
            </div>

            {!canEditForm && (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Modo lectura: necesitas permiso identity.users.update para
                editar.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {canReadUsers && user && canManageGrants && (
        <UserPermissionGrantsCard
          userId={user.id}
          token={token}
          canManage={canManageUsers && isEditRoute}
        />
      )}

      {canReadUsers && user && !isEditRoute && (
        <Card>
          <CardHeader>
            <CardTitle>Actividad reciente</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ActivityTimeline
              sdk={runly}
              token={token}
              entityType="UserProfile"
              entityId={user.id}
              limit={20}
              heightClass="max-h-[320px]"
              emptyMessage="Sin actividad registrada para este usuario."
            />
          </CardContent>
        </Card>
      )}

      {canEditForm && draft && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <div className="px-6 py-3 flex items-center justify-between gap-4">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Cambios sin guardar
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDraft(null)}
                disabled={updateUserMutation.isPending}
              >
                Descartar
              </Button>
              <Button
                size="sm"
                onClick={saveChanges}
                disabled={
                  updateUserMutation.isPending ||
                  !effective.firstName ||
                  !effective.lastName
                }
              >
                {updateUserMutation.isPending
                  ? "Guardando..."
                  : "Guardar cambios"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {user?.avatarFileId && (
        <AdvancedFileViewer
          open={imageViewerOpen}
          onOpenChange={setImageViewerOpen}
          files={[
            {
              id: user.avatarFileId,
              mimeType: "image/jpeg",
              originalName: user.displayName ?? "Foto de perfil",
              sizeBytes: 0,
            },
          ]}
          activeIndex={0}
          onIndexChange={() => {}}
          onResolveSignedUrl={resolveUserAvatarSignedUrl}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="¿Eliminar usuario?"
        description="Esta acción es irreversible. Se eliminará la cuenta del usuario y no podrá recuperarse."
        detail={user?.displayName || user?.email}
        confirmLabel="Eliminar"
        onConfirm={() =>
          toast.promise(deleteUserMutation.mutateAsync(), {
            loading: "Eliminando usuario...",
            success: "Usuario eliminado",
            error: (e) => {
              try {
                return (
                  JSON.parse(e?.message || "{}").error ||
                  "No se pudo eliminar el usuario"
                );
              } catch {
                return "No se pudo eliminar el usuario";
              }
            },
          })
        }
        loading={deleteUserMutation.isPending}
      />
    </div>
  );
}
